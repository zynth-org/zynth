package com.rune.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.SparseArray
import android.view.Gravity
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import com.rune.kit.debug.PerformanceProfiler
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.MeasureInput
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Rect
import com.rune.kit.layout.Style
import com.rune.kit.runtime.JSBridge
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import java.util.HashMap
import java.util.LinkedHashSet
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import kotlin.math.roundToInt

private const val DEBUG_SCROLL_LAYOUT = false

class RuneUIManager(
  private val root: RuneRootView,
  private val engine: LayoutEngine,
  private val eventDispatcher: (Int, String) -> Unit = { _, _ -> },
  private val handlerListener: (Int, String, Long) -> Unit = { _, _, _ -> },
) : JSBridge.UIShim, RuneButtonView.Listener, RunePressableView.Listener {
  private fun isNativeDebugEnabled(): Boolean {
    return try {
      val debugValue = System.getProperty("__NATIVE_DEBUG__")
      debugValue?.toBoolean() ?: false
    } catch (e: Exception) {
      false
    }
  }

  private fun logDebug(tag: String, message: String) {
    if (!isNativeDebugEnabled()) return
    Log.d(tag, message)
  }
  data class Node(
    val id: Int,
    val type: String,
    val view: View,
    val label: TextView? = null,
    val textChildren: MutableList<Int> = mutableListOf(),
    var parentId: Int? = null,
    var cachedText: String = "",
    var imageState: ImageState? = null,
    var pointerEvents: String = "auto",
    var textInputState: TextInputState? = null,
    var hasCompletedInitialMount: Boolean = false,
  )

  data class SelectionSpec(var start: Int, var end: Int)

  data class TextInputState(
    var defaultValue: String = "",
    var currentText: String = "",
    var awaitingInitialValue: Boolean = true,
    var hasAppliedInitialText: Boolean = false,
    var pendingSelection: SelectionSpec? = null,
    var lastExactHeight: Int = 0,
  )

  private sealed class ViewOperation {
    data class Insert(val parentId: Int, val childId: Int, val index: Int) : ViewOperation()
    data class Remove(val parentId: Int, val node: Node) : ViewOperation()
  }

  private sealed class NativeOperation {
    data class SetProp(val nodeId: Int, val name: String, val jsonValue: String?) : NativeOperation()
    data class SetText(val nodeId: Int, val text: String) : NativeOperation()
    data class SetHandler(val nodeId: Int, val event: String, val handlerId: Long) : NativeOperation()
  }

  private fun shouldPrioritizeTextInputProp(operation: NativeOperation.SetProp): Boolean {
    val node = nodes.get(operation.nodeId) ?: return false
    val isTextInput = node.type == TEXT_INPUT_TYPE || node.type == SECURE_TEXT_INPUT_TYPE
    return isTextInput && TEXT_INPUT_MEASURE_PROPS.contains(operation.name)
  }

  private fun processPendingNativeOperations() {
    if (pendingNativeOperations.isEmpty()) return
    val operations = pendingNativeOperations.toList()
    pendingNativeOperations.clear()
    val prioritized = mutableListOf<NativeOperation>()
    val remaining = mutableListOf<NativeOperation>()
    operations.forEach { op ->
      if (op is NativeOperation.SetProp && shouldPrioritizeTextInputProp(op)) {
        prioritized.add(op)
      } else {
        remaining.add(op)
      }
    }
    (prioritized + remaining).forEach { op ->
      when (op) {
        is NativeOperation.SetProp -> applySetProp(op.nodeId, op.name, op.jsonValue)
        is NativeOperation.SetText -> applySetText(op.nodeId, op.text)
        is NativeOperation.SetHandler -> applySetHandler(op.nodeId, op.event, op.handlerId)
      }
    }
  }

  private fun processPendingViewOperations() {
    if (pendingViewOperations.isEmpty() || viewTransactionInProgress) return
    viewTransactionInProgress = true
    try {
      val operationsByParent = pendingViewOperations.groupBy {
        when (it) {
          is ViewOperation.Insert -> it.parentId
          is ViewOperation.Remove -> it.parentId
        }
      }
      operationsByParent.forEach { (parentId, operations) ->
        val parentView = if (parentId == root.rootId) {
          root
        } else {
          nodes.get(parentId)?.view as? ViewGroup
        }

        if (parentView == null) {
          operations.filterIsInstance<ViewOperation.Remove>().forEach { op ->
            detachChildView(parentId, op.node)
          }
          return@forEach
        }

        parentView.suppressLayoutCompat(true)
        try {
          operations.forEach { operation ->
            when (operation) {
              is ViewOperation.Insert -> {
                val childNode = nodes.get(operation.childId)
                if (childNode == null) {
                  Log.w(
                    "RuneUI",
                    "processPendingViewOperations: insert node ${operation.childId} missing for parent $parentId",
                  )
                  return@forEach
                }
                val childView = childNode.view
                (childView.parent as? ViewGroup)?.removeView(childView)
                val safeIndex = operation.index.coerceIn(0, parentView.childCount)
                parentView.addView(childView, safeIndex)
                if (
                  !childNode.hasCompletedInitialMount &&
                  (childNode.type == TEXT_INPUT_TYPE || childNode.type == SECURE_TEXT_INPUT_TYPE)
                ) {
                  scheduleFlush(FlushPriority.HIGH)
                }
                childNode.hasCompletedInitialMount = true
              }
              is ViewOperation.Remove -> {
                detachChildView(operation.parentId, operation.node)
              }
            }
          }
        } finally {
          parentView.suppressLayoutCompat(false)
        }
      }
    } finally {
      pendingViewOperations.clear()
      viewTransactionInProgress = false
    }
  }

  private fun applySetProp(nodeId: Int, name: String, jsonValue: String?) {
    propApplier.applySetProp(nodeId, name, jsonValue)
  }

  private fun applySetText(nodeId: Int, text: String) {
    propApplier.applySetText(nodeId, text, ::propagateTextChange)
  }

  private fun applySetHandler(nodeId: Int, event: String, handlerId: Long) {
    propApplier.applySetHandler(nodeId, event, eventDispatcher, handlerListener, handlerId)
  }

  private fun applyStyleToButton(nodeId: Int, button: RuneButtonView, style: Style) {
    propApplier.applyBackgroundStyle(button, style)
  }

  private val nodes = SparseArray<Node>()
  private val parents = HashMap<Int, Int?>()
  private val pendingTextRebuild = LinkedHashSet<Int>()
  private val handler = Handler(Looper.getMainLooper())
  private val frameScheduler = FrameScheduler()
  private val imageSupport = RuneImageSupport(
    root = root,
    engine = engine,
    handler = handler,
    eventDispatcher = eventDispatcher,
    scheduleFlush = this::scheduleFlush,
    storeEventPayload = this::storeEventPayload,
    runOnMainThread = this::runOnMainThread,
  )
  private val eventPayloads = HashMap<String, ArrayDeque<String>>()
  private val pendingViewOperations = mutableListOf<ViewOperation>()
  private val pendingNativeOperations = mutableListOf<NativeOperation>()
  private val stickyFrameCarryover = mutableSetOf<Int>()
  private val buttonStyles = SparseArray<ButtonVisualStyle>()
  private val propApplier = RunePropApplier(
    nodes = nodes,
    engine = engine,
    imageSupport = imageSupport,
    buttonStyles = buttonStyles,
    deriveButtonVisualStyle = ::deriveButtonVisualStyle,
    applyVisualStyle = ::applyVisualStyle,
    logDebug = ::logDebug,
    resolveTextNode = ::resolveTextNode,
    onTextInputTextUpdated = ::onTextInputTextUpdated,
  )
  private val eventManager = RuneEventManager(
    nodes = nodes,
    engine = engine,
    eventDispatcher = eventDispatcher,
    handlerListener = handlerListener,
    eventPayloads = eventPayloads,
    ensureTextInputState = ::ensureTextInputState,
  )
  @Volatile private var viewTransactionInProgress = false
  @Volatile private var layoutTransactionActive = false
  private enum class FlushPriority { HIGH, NORMAL }
  private var flushCoalesceScheduled = false
  private var pendingFlushPriority = FlushPriority.NORMAL
  private var nextId = root.rootId + 1
  @Volatile private var dirty = false
  private var lastRootWidth = -1
  private var lastRootHeight = -1

  init {
    parents[root.rootId] = null
    root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      val w = root.width
      val h = root.height
      if (w != lastRootWidth || h != lastRootHeight) {
        lastRootWidth = w
        lastRootHeight = h
        scheduleFlush()
        flush()
      }
    }
  }

  private fun storeEventPayload(nodeId: Int, event: String, payload: JSONObject?) {
    eventManager.storeEventPayload(nodeId, event, payload)
  }

  fun consumeEventPayload(nodeId: Int, event: String): JSONObject? {
    return eventManager.consumeEventPayload(nodeId, event)
  }

  fun dequeueEventPayloadJson(nodeId: Int, event: String): String? {
    return eventManager.dequeueEventPayloadJson(nodeId, event)
  }

  private fun isVirtualTextNode(node: Node): Boolean {
    val parent = node.parentId?.let { nodes.get(it) }
    return node.type == TEXT_TYPE && parent?.type == TEXT_TYPE
  }

  private fun recomputeTextForNode(node: Node?): String {
    if (node == null) return ""
    if (node.type != TEXT_TYPE) {
      return node.label?.text?.toString()
        ?: (node.view as? TextView)?.text?.toString()
        ?: node.cachedText
    }
    if (node.textChildren.isEmpty()) {
      return node.cachedText
    }
    val builder = StringBuilder()
    node.textChildren.forEach { childId ->
      val childText = recomputeTextForNode(nodes.get(childId))
      builder.append(childText)
    }
    return builder.toString()
  }

  private fun propagateTextChange(node: Node) {
    var currentParentId = node.parentId
    while (currentParentId != null) {
      val parent = nodes.get(currentParentId) ?: break
      if (parent.type != TEXT_TYPE) break
      pendingTextRebuild.add(parent.id)
      engine.markDirty(parent.id)
      currentParentId = parent.parentId
    }
  }

  private fun recomputeAndPropagate(node: Node) {
    pendingTextRebuild.add(node.id)
    engine.markDirty(node.id)
    propagateTextChange(node)
  }

  override fun createNode(type: String): Int = onMain {
    val id = nextId++
    val view: View
    val label: TextView?
    if (type == TEXT_TYPE) {
      val text = TextView(root.context)
      text.textSize = 16f
      text.setTextColor(Color.WHITE)
      text.gravity = Gravity.START
      logDebug("RuneUI", "Created text node $id")
      view = text
      label = text
    } else if (type == TEXT_INPUT_TYPE || type == SECURE_TEXT_INPUT_TYPE) {
      val inputView = if (type == SECURE_TEXT_INPUT_TYPE) {
        RuneSecureTextInputView(root.context)
      } else {
        RuneTextInputView(root.context)
      }
      inputView.manager = this
      inputView.nodeId = id
      inputView.applyEditable(true)
      inputView.applyMultiline(false)
      inputView.applyNumberOfLines(0)
      inputView.submitBehavior = "submit"
      inputView.blurOnSubmit = false
      view = inputView
      label = null
      val params = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
      inputView.layoutParams = params
    } else if (type == IMAGE_TYPE) {
      val imageView = ImageView(root.context)
      imageView.adjustViewBounds = true
      imageView.scaleType = ImageView.ScaleType.CENTER_CROP
      imageView.setBackgroundColor(Color.TRANSPARENT)
      view = imageView
      label = null
    } else if (type == SCROLL_VIEW_TYPE) {
      val scrollView = RuneScrollView(root.context)
      scrollView.bind(this, id)
      view = scrollView
      label = null
    } else if (type == BUTTON_TYPE) {
      val button = RuneButtonView(root.context)
      button.nodeId = id
      button.listener = this
      button.background = GradientDrawable()
      view = button
      label = null
      val initialStyle = deriveButtonVisualStyle(Style(), null, button)
      buttonStyles.put(id, initialStyle)
      applyVisualStyle(button, initialStyle)
    } else if (type == PRESSABLE_TYPE) {
      val pressable = RunePressableView(root.context)
      pressable.nodeId = id
      pressable.listener = this
      view = pressable
      label = null
    } else {
      view = FrameLayout(root.context)
      label = null
    }
    // Use appropriate layout params based on type - this helps prevent layout jumps
    when (type) {
      TEXT_TYPE -> {
        view.layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
      }
      TEXT_INPUT_TYPE, SECURE_TEXT_INPUT_TYPE -> {
        val params = view.layoutParams as? FrameLayout.LayoutParams
          ?: FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
          )
        params.width = FrameLayout.LayoutParams.WRAP_CONTENT
        params.height = FrameLayout.LayoutParams.WRAP_CONTENT
        view.layoutParams = params
        view.isClickable = true
        view.isFocusable = true
        view.isFocusableInTouchMode = true
      }
      BUTTON_TYPE, PRESSABLE_TYPE -> {
        val params = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        view.layoutParams = params
        view.isClickable = true
        view.isFocusable = true
        view.isFocusableInTouchMode = true
      }
      else -> {
        view.layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        view.isClickable = false
      }
    }
    view.setBackgroundColor(Color.TRANSPARENT)
    val node = Node(id, type, view, label)
    node.cachedText = (label?.text?.toString() ?: "")
    if (type == IMAGE_TYPE) {
      imageSupport.initializeNode(node)
    }
    if (type == TEXT_INPUT_TYPE || type == SECURE_TEXT_INPUT_TYPE) {
      node.textInputState = TextInputState()
    }
    nodes.put(id, node)
    parents[id] = null
    engine.createNode(id)
    // Default non-text views to full width unless overridden by explicit style
    if (label == null) {
      try {
        engine.setStyle(id, Style(widthPercent = 100f))
      } catch (_: Throwable) {
        // Defensive: style application should never crash creation
      }
    }
    if (label != null) {
      engine.setMeasureHandler(id) { input ->
        val widthValue = when {
          input.width.isNaN() -> 0
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        }
        val heightValue = when {
          input.height.isNaN() -> 0
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        }
        val widthSpec = when (input.widthMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        val heightSpec = when (input.heightMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        label.measure(widthSpec, heightSpec)
        val measuredWidth = label.measuredWidth.coerceAtLeast(1)
        val measuredHeight = label.measuredHeight.coerceAtLeast((label.textSize * 1.2f).roundToInt())
        measuredWidth.toFloat() to measuredHeight.toFloat()
      }
    } else if (type == TEXT_INPUT_TYPE || type == SECURE_TEXT_INPUT_TYPE) {
      val inputView = view as RuneTextInputView
      engine.setMeasureHandler(id) { input ->
        measureTextInput(inputView, input)
      }
    } else if (type == IMAGE_TYPE) {
      engine.setMeasureHandler(id) { input ->
        imageSupport.measure(node, input)
      }
    }
    id
  }

  private fun parseString(json: String?): String? {
    if (json == null || json == "null") return null
    // The string is JSON-encoded, so it's wrapped in quotes.
    if (json.length >= 2 && json.startsWith("\"") && json.endsWith("\"")) {
      return json.substring(1, json.length - 1)
    }
    return json
  }

  private fun parseJsonValue(raw: String?): Any? {
    if (raw == null) return null
    val trimmed = raw.trim()
    if (trimmed.isEmpty() || trimmed == "null") return null
    return try {
      val value = JSONTokener(trimmed).nextValue()
      if (value === JSONObject.NULL) null else value
    } catch (_: JSONException) {
      trimmed
    }
  }

  private fun parseColorValue(raw: Any?): Int? {
    val value = when (raw) {
      null -> return null
      is Number -> raw.toInt()
      else -> raw.toString().trim()
    }
    return try {
      when (value) {
        is Int -> value
        is String -> Color.parseColor(
          if (value.startsWith("#") || value.startsWith("rgb", ignoreCase = true)) value else "#$value".takeIf {
            value.matches(Regex("[0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3}"))
          } ?: value,
        )
        else -> null
      }
    } catch (e: IllegalArgumentException) {
      when (value) {
        is String -> {
          when (value.lowercase()) {
            "transparent" -> Color.TRANSPARENT
            "black" -> Color.BLACK
            "white" -> Color.WHITE
            "red" -> Color.RED
            "green" -> Color.GREEN
            "blue" -> Color.BLUE
            "yellow" -> Color.YELLOW
            "cyan" -> Color.CYAN
            "magenta" -> Color.MAGENTA
            "gray", "grey" -> Color.GRAY
            "darkgray", "darkgrey" -> Color.DKGRAY
            "lightgray", "lightgrey" -> Color.LTGRAY
            else -> null
          }
        }
        else -> null
      }
    }
  }

  private fun applyTextInputStyle(view: RuneTextInputView, style: Style, nodeId: Int) {
    // Start from ZERO, not from current padding
    var left = 0
    var top = 0
    var right = 0  
    var bottom = 0

    fun Float?.asPx(): Int? = this?.roundToInt()?.coerceAtLeast(0)

    // Apply style padding values - these should replace, not accumulate
    style.padding.asPx()?.let { value ->
        left = value
        top = value
        right = value
        bottom = value
    }
    style.paddingHorizontal.asPx()?.let { value ->
        left = value
        right = value
    }
    style.paddingVertical.asPx()?.let { value ->
        top = value
        bottom = value
    }
    style.paddingLeft.asPx()?.let { left = it }
    style.paddingRight.asPx()?.let { right = it }
    style.paddingTop.asPx()?.let { top = it }
    style.paddingBottom.asPx()?.let { bottom = it }

    val paddingChanged = view.updateStylePadding(left, top, right, bottom)
    if (isNativeDebugEnabled()) {
      Log.d(
          "RuneTextInputView",
          "applyTextInputStyle paddingTop=$top paddingBottom=$bottom maxLines=${view.maxLines} minLines=${view.minLines} minHeight=${view.minHeight} minimumHeight=${view.minimumHeight} measured=${view.measuredHeight} scrollY=${view.scrollY}",
      )
    }
    val baselineChanged = view.ensureBaselineConstraints()
    if (paddingChanged || baselineChanged) {
        view.requestLayout()
    }
    engine.markDirty(nodeId)
  }

  private fun applyBackgroundStyle(view: View, style: Style) {
    val backgroundColor = style.backgroundColor
    val borderRadius = style.borderRadius?.coerceAtLeast(0f)
    val borderColor = style.borderColor
    val borderWidth = style.borderWidth?.coerceAtLeast(0f)
    val borderStyle = style.borderStyle?.lowercase()
    val needsRoundedBackground = borderRadius != null && borderRadius > 0f
    val shouldUseGradient = needsRoundedBackground || backgroundColor != null || (borderWidth ?: 0f) > 0f || borderColor != null
    val paddingStart = ViewCompat.getPaddingStart(view)
    val paddingTop = view.paddingTop
    val paddingEnd = ViewCompat.getPaddingEnd(view)
    val paddingBottom = view.paddingBottom

    if (shouldUseGradient) {
      val existing = (view.background as? GradientDrawable)?.mutate() as? GradientDrawable
      val drawable = existing ?: GradientDrawable()
      drawable.cornerRadius = borderRadius ?: 0f
      drawable.setColor(backgroundColor ?: Color.TRANSPARENT)

      val strokeWidth = (borderWidth ?: 0f).coerceAtLeast(0f)
      if (strokeWidth > 0f && borderColor != null) {
        val strokeWidthInt = strokeWidth.roundToInt().coerceAtLeast(1)
        when (borderStyle) {
          "dashed" -> {
            val dash = strokeWidthInt * 3f
            drawable.setStroke(strokeWidthInt, borderColor, dash, strokeWidthInt * 2f)
          }
          "dotted" -> {
            val dash = strokeWidthInt.toFloat()
            drawable.setStroke(strokeWidthInt, borderColor, dash, dash * 1.5f)
          }
          else -> drawable.setStroke(strokeWidthInt, borderColor)
        }
      } else {
        drawable.setStroke(0, borderColor ?: Color.TRANSPARENT)
      }

      ViewCompat.setBackground(view, drawable)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.clipToOutline = needsRoundedBackground
      }
    } else {
      when (val current = view.background) {
        is GradientDrawable, is ColorDrawable -> ViewCompat.setBackground(view, null)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.clipToOutline = false
      }
    }

    if (shouldUseGradient) {
      ViewCompat.setPaddingRelative(view, paddingStart, paddingTop, paddingEnd, paddingBottom)
    }
  }

  private fun handleTextInputProp(node: Node, name: String, rawJson: String?): Boolean {
    val view = node.view as? RuneTextInputView ?: return false
    val state = ensureTextInputState(node)

    val parsed = parseJsonValue(rawJson)
    return when (name) {
      "style" -> false
      "value" -> {
        val textValue = parsed?.toString() ?: ""
        if (!textValue.contentEquals(view.text?.toString())) {
          view.performProgrammaticUpdate {
            if (!textValue.contentEquals(view.text?.toString())) {
              view.setText(textValue)
            }
          }
        } else {
          onTextInputIntrinsicSizeChanged(node.id)
        }
        state.awaitingInitialValue = false
        state.hasAppliedInitialText = true
        onTextInputTextUpdated(node.id, textValue)
        true
      }
      "defaultValue" -> {
        val textValue = parsed?.toString() ?: ""
        val previousDefault = state.defaultValue
        state.defaultValue = textValue
        var shouldApply = state.awaitingInitialValue || !state.hasAppliedInitialText
        if (!shouldApply) {
          val current = state.currentText.ifEmpty { view.text?.toString().orEmpty() }
          shouldApply = current.isEmpty() || current == previousDefault
        }
        if (shouldApply) {
          view.performProgrammaticUpdate {
            if (!textValue.contentEquals(view.text?.toString())) {
              view.setText(textValue)
            }
          }
          onTextInputTextUpdated(node.id, textValue)
          state.awaitingInitialValue = false
          state.hasAppliedInitialText = true
        }
        true
      }
      "placeholder" -> {
        val placeholder = (parsed as? String) ?: parseString(rawJson)
        view.applyPlaceholder(placeholder)
        true
      }
      "multiline" -> {
        val multiline = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> false
        }
        view.applyMultiline(multiline)
        true
      }
      "numberOfLines" -> {
        val lines = when (parsed) {
          is Number -> parsed.toInt()
          else -> 0
        }
        view.applyNumberOfLines(lines)
        true
      }
      "maxLength" -> {
        view.maxLength = when (parsed) {
          is Number -> parsed.toInt()
          is String -> parsed.toIntOrNull() ?: -1
          else -> -1
        }
        true
      }
      "editable" -> {
        val editable = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> true
        }
        view.applyEditable(editable)
        true
      }
      "secureTextEntry" -> {
        val secure = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> false
        }
        view.applySecureEntry(secure)
        true
      }
      "inputMode" -> {
        val mode = (parsed as? String) ?: parseString(rawJson)
        view.applyInputMode(mode)
        true
      }
      "autoCapitalize" -> {
        val mode = (parsed as? String) ?: parseString(rawJson)
        view.applyAutoCapitalize(mode)
        true
      }
      "autoCorrect" -> {
        view.applyAutoCorrect(parsed as? Boolean)
        true
      }
      "spellCheck" -> {
        view.applySpellCheck(parsed as? Boolean)
        true
      }
      "returnKeyType" -> {
        val type = (parsed as? String) ?: parseString(rawJson)
        view.applyReturnKeyType(type)
        true
      }
      "blurOnSubmit" -> {
        view.blurOnSubmit = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> false
        }
        true
      }
      "submitBehavior" -> {
        val behavior = (parsed as? String)?.takeIf { it.isNotBlank() }
          ?: parseString(rawJson)?.takeIf { it.isNotBlank() }
          ?: "submit"
        view.submitBehavior = behavior
        true
      }
      "selection" -> {
        val selectionJson = parsed as? JSONObject
        if (selectionJson != null) {
          val start = selectionJson.optInt("start", selectionJson.optInt("begin", 0))
          val end = selectionJson.optInt("end", start)
          val spec = SelectionSpec(start.coerceAtLeast(0), end.coerceAtLeast(0))
          state.pendingSelection = spec
          view.post {
            state.pendingSelection?.let { pending ->
              if (pending.start == spec.start && pending.end == spec.end) {
                view.applySelection(pending.start, pending.end)
              }
            }
          }
        }
        true
      }
      "selectionColor" -> {
        val color = parseColorValue(parsed)
        view.applySelectionColor(color)
        true
      }
      "caretColor" -> {
        val color = parseColorValue(parsed)
        view.applyCaretColor(color)
        true
      }
      "eventThrottleMs" -> {
        val throttle = when (parsed) {
          is Number -> parsed.toLong()
          is String -> parsed.toLongOrNull()
          else -> null
        } ?: 0L
        view.applyEventThrottle(throttle)
        true
      }
      "allowProgrammaticJumpDuringEdit" -> {
        val allow = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> false
        }
        view.allowProgrammaticJumpDuringEdit = allow
        true
      }
      "__focusRequest" -> {
        view.requestFocusFromJS()
        true
      }
      "clearButtonMode" -> {
        logDebug("RuneUI", "clearButtonMode is not supported on Android; ignoring value: $parsed")
        true
      }
      "showClearAccessory" -> {
        logDebug("RuneUI", "showClearAccessory is not supported on Android; ignoring value: $parsed")
        true
      }
      else -> false
    }
  }

  private fun measureTextInput(view: RuneTextInputView, input: MeasureInput): Pair<Float, Float> {
    val node = nodes.get(view.nodeId)
    if (node != null) {
      val state = ensureTextInputState(node)
      if (state.lastExactHeight > 0) {
        view.setExpectedExactHeight(state.lastExactHeight)
      }
    }
    val widthSpec = when (input.widthMode) {
      MeasureMode.EXACTLY -> View.MeasureSpec.makeMeasureSpec(
        when {
          input.width.isNaN() -> 0
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        },
        View.MeasureSpec.EXACTLY,
      )
      MeasureMode.AT_MOST -> View.MeasureSpec.makeMeasureSpec(
        when {
          input.width.isNaN() -> Int.MAX_VALUE / 2
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        },
        View.MeasureSpec.AT_MOST,
      )
      MeasureMode.UNDEFINED -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    }

    val heightSpec = when (input.heightMode) {
      MeasureMode.EXACTLY -> View.MeasureSpec.makeMeasureSpec(
        when {
          input.height.isNaN() -> 0
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        },
        View.MeasureSpec.EXACTLY,
      )
      MeasureMode.AT_MOST -> View.MeasureSpec.makeMeasureSpec(
        when {
          input.height.isNaN() -> Int.MAX_VALUE / 2
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        },
        View.MeasureSpec.AT_MOST,
      )
      MeasureMode.UNDEFINED -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    }

    view.measure(widthSpec, heightSpec)

    val targetWidth = if (input.widthMode == MeasureMode.EXACTLY) {
      View.MeasureSpec.getSize(widthSpec)
    } else {
      view.measuredWidth
    }.coerceAtLeast(1)

    val targetHeight = when (input.heightMode) {
      MeasureMode.EXACTLY -> View.MeasureSpec.getSize(heightSpec)
      MeasureMode.AT_MOST, MeasureMode.UNDEFINED -> view.measuredHeight
    }.coerceAtLeast(1)

    return targetWidth.toFloat() to targetHeight.toFloat()
  }

  private fun ensureTextInputState(node: Node): TextInputState {
    val existing = node.textInputState
    if (existing != null) return existing
    val created = TextInputState()
    node.textInputState = created
    return created
  }

  private fun cleanupTextInput(node: Node) {
    (node.view as? RuneTextInputView)?.let { input ->
      input.clearHandlers()
      input.manager = null
      input.nodeId = -1
    }
    node.textInputState = null
  }

  internal fun emitTextInputEvent(nodeId: Int, event: String, payload: JSONObject?) {
    eventManager.emitTextInputEvent(nodeId, event, payload)
  }

  internal fun dispatchEvent(nodeId: Int, event: String, payload: JSONObject?) {
    eventManager.dispatchEvent(nodeId, event, payload)
  }

  override fun onPressIn(nodeId: Int) {
    eventManager.onPressIn(nodeId)
  }

  override fun onPressOut(nodeId: Int, cancelled: Boolean) {
    eventManager.onPressOut(nodeId, cancelled)
  }

  override fun onPress(nodeId: Int) {
    eventManager.onPress(nodeId)
  }

  override fun onLongPress(nodeId: Int, durationMs: Long) {
    eventManager.onLongPress(nodeId, durationMs)
  }

  override fun onFocus(nodeId: Int) {
    eventManager.onFocus(nodeId)
  }

  override fun onBlur(nodeId: Int) {
    eventManager.onBlur(nodeId)
  }

  override fun onKeyEvent(nodeId: Int, phase: String, key: String?) {
    eventManager.onKeyEvent(nodeId, phase, key)
  }

  override fun onPressablePressIn(nodeId: Int, payload: JSONObject) {
    eventManager.onPressablePressIn(nodeId, payload)
  }

  override fun onPressablePressOut(nodeId: Int, payload: JSONObject, cancelled: Boolean) {
    eventManager.onPressablePressOut(nodeId, payload, cancelled)
  }

  override fun onPressablePress(nodeId: Int, payload: JSONObject) {
    eventManager.onPressablePress(nodeId, payload)
  }

  override fun onPressableLongPress(nodeId: Int, durationMs: Long, payload: JSONObject) {
    eventManager.onPressableLongPress(nodeId, durationMs, payload)
  }

  override fun onPressableDoublePress(nodeId: Int, payload: JSONObject) {
    eventManager.onPressableDoublePress(nodeId, payload)
  }

  override fun onPressableHover(nodeId: Int, hovering: Boolean) {
    eventManager.onPressableHover(nodeId, hovering)
  }

  override fun onPressableFocus(nodeId: Int) {
    eventManager.onPressableFocus(nodeId)
  }

  override fun onPressableBlur(nodeId: Int) {
    eventManager.onPressableBlur(nodeId)
  }

  override fun onPressableKeyEvent(nodeId: Int, phase: String, payload: JSONObject) {
    eventManager.onPressableKeyEvent(nodeId, phase, payload)
  }

  override fun onPressableCancel(nodeId: Int, payload: JSONObject) {
    eventManager.onPressableCancel(nodeId, payload)
  }

  internal fun onTextInputTextUpdated(nodeId: Int, text: String) {
    eventManager.onTextInputTextUpdated(nodeId, text)
  }

  internal fun onTextInputLayout(nodeId: Int, height: Int) {
    eventManager.onTextInputLayout(nodeId, height)
  }

  internal fun clearTextInputExactHeight(nodeId: Int) {
    eventManager.clearTextInputExactHeight(nodeId)
  }

  internal fun onTextInputIntrinsicSizeChanged(nodeId: Int) {
    eventManager.onTextInputIntrinsicSizeChanged(nodeId)
    scheduleFlush()
  }

  override fun setProp(nodeId: Int, name: String, jsonValue: String?) = onMain {
    pendingNativeOperations.add(NativeOperation.SetProp(nodeId, name, jsonValue))
    scheduleFlush()
  }

  override fun setText(nodeId: Int, text: String) = onMain {
    pendingNativeOperations.add(NativeOperation.SetText(nodeId, text))
    scheduleFlush()
  }

  override fun insertChild(parentId: Int, childId: Int, index: Int) = onMain {
    parents[childId] = parentId
    nodes.get(childId)?.parentId = parentId
    val parentNode = nodes.get(parentId)
    if (parentNode?.type == TEXT_TYPE) {
      // If parent is a text node, merge text content from child instead of nesting views
      val childNode = nodes.get(childId)
      if (childNode?.type == TEXT_TYPE) {
        val insertIndex = index.coerceIn(0, parentNode.textChildren.size)
        parentNode.textChildren.remove(childId)
        parentNode.textChildren.add(insertIndex, childId)
        pendingTextRebuild.add(parentNode.id)
        engine.markDirty(parentNode.id)
        propagateTextChange(parentNode)
      }
      scheduleFlush()
      return@onMain
    }
    val node = nodes.get(childId)
    if (node == null) {
      Log.w("RuneUI", "insertChild: node $childId not found for parent $parentId")
      return@onMain
    }
    pendingViewOperations.removeAll { op ->
      op is ViewOperation.Remove && op.node.id == childId
    }
    pendingViewOperations.add(ViewOperation.Insert(parentId, childId, index))
    engine.insertChild(parentId, childId, index)
    scheduleFlush()
  }

  override fun removeChild(parentId: Int, childId: Int) = onMain {
    val parentNode = nodes.get(parentId)
    if (parentNode?.type == TEXT_TYPE) {
      parentNode.textChildren.remove(childId)
      parents[childId] = null
      nodes.get(childId)?.parentId = null
      pendingTextRebuild.add(parentNode.id)
      engine.markDirty(parentNode.id)
      propagateTextChange(parentNode)
      scheduleFlush()
      return@onMain
    }

    val childNode = nodes.get(childId)
    if (childNode == null) {
      Log.w("RuneUI", "removeChild: node $childId not found for parent $parentId")
      return@onMain
    }
    pendingViewOperations.removeAll { op ->
      op is ViewOperation.Insert && op.parentId == parentId && op.childId == childId
    }
    pendingViewOperations.add(ViewOperation.Remove(parentId, childNode))
    removeNodeRecursive(childId, detachView = false)
    scheduleFlush()
  }

  override fun setHandler(nodeId: Int, event: String, handlerId: Long) = onMain {
    pendingNativeOperations.add(NativeOperation.SetHandler(nodeId, event, handlerId))
    scheduleFlush()
  }

  override fun removeNode(nodeId: Int) = onMain {
    removeNodeRecursive(nodeId)
    scheduleFlush()
  }

  fun hasRenderableContent(): Boolean = onMain { nodes.size() > 0 }

  fun clearAllNodes() = onMain {
    logDebug("RuneUI", "Clearing all nodes for dev reload")
    frameScheduler.cancelFlush()
    handler.removeCallbacksAndMessages(null)
    pendingTextRebuild.clear()
    pendingViewOperations.clear()
    pendingNativeOperations.clear()
    eventPayloads.clear()
    dirty = false
    viewTransactionInProgress = false
    flushCoalesceScheduled = false

    // Remove all nodes recursively starting from leaves
    val nodesToRemove = nodes.size().let { size ->
        (0 until size).map { nodes.keyAt(it) }
    }.filter { it != root.rootId }
    
    nodesToRemove.forEach { nodeId ->
        removeNodeRecursive(nodeId)
    }

    // Final cleanup
    parents.clear()
    parents[root.rootId] = null
    nextId = root.rootId + 1
    lastRootWidth = -1
    lastRootHeight = -1
    buttonStyles.clear()

    engine.reset()
  }

  private fun runOnMainThread(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      handler.post { block() }
    }
  }

  override fun dequeueEventPayload(nodeId: Int, event: String): String? {
    return dequeueEventPayloadJson(nodeId, event)
  }

  override fun flush() = onMain {
    dirty = true
    if (layoutTransactionActive) return@onMain
    if (root.width > 0 && root.height > 0) {
      frameScheduler.cancelFlush()
      performFlush()
    } else {
      scheduleFlush()
    }
  }

  private fun scheduleFlush(priority: FlushPriority = FlushPriority.NORMAL) {
    dirty = true
    if (layoutTransactionActive) return
    if (priority.ordinal < pendingFlushPriority.ordinal) {
      pendingFlushPriority = priority
    }
    if (flushCoalesceScheduled) return
    flushCoalesceScheduled = true
    frameScheduler.scheduleFlush {
      flushCoalesceScheduled = false
      val dispatchPriority = pendingFlushPriority
      pendingFlushPriority = FlushPriority.NORMAL
      if (layoutTransactionActive) {
        scheduleFlush(dispatchPriority)
        return@scheduleFlush
      }
      if (dirty) {
        performFlush()
      }
    }
  }

  private inline fun <T> onMain(crossinline block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return block()
    }
    var result: T? = null
    val latch = CountDownLatch(1)
    handler.post {
      result = block()
      latch.countDown()
    }
    latch.await()
    @Suppress("UNCHECKED_CAST")
    return result as T
  }

  private fun performFlush() {
    if (layoutTransactionActive) return
    layoutTransactionActive = true
    root.suppressLayoutCompat(true)
    val stickyRelayoutNodes = mutableSetOf<Int>()
    try {
      if (root.width == 0 || root.height == 0) {
        handler.post { performFlush() }
        return
      }

      if (!dirty && pendingNativeOperations.isEmpty() && pendingViewOperations.isEmpty()) return

      do {
        dirty = false

        PerformanceProfiler.recordLayoutStart()
        processPendingNativeOperations()
        processPendingViewOperations()
        drainPendingTextRebuilds()

        val previousFrames = SparseArray<Rect>()
        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (node.view.visibility == View.VISIBLE) {
            previousFrames.put(node.id, Rect(
              node.view.left,
              node.view.top,
              node.view.right,
              node.view.bottom,
            ))
          }
        }

        engine.calculateLayout(root.width, root.height)
        PerformanceProfiler.recordLayoutEnd()

        PerformanceProfiler.recordRenderStart()

        val appliedFrames = SparseArray<Rect>()
        val stickyNodesForRelayout = mutableSetOf<Int>()
        val stickyFramesUsedThisFrame = mutableSetOf<Int>()

        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (isVirtualTextNode(node)) continue
          val rawFrame: Rect = engine.frame(node.id)
          val rawWidth = rawFrame.right - rawFrame.left
          val rawHeight = rawFrame.bottom - rawFrame.top
          val previous = previousFrames.get(node.id)
          val previousWidth = previous?.let { it.right - it.left } ?: 0
          val previousHeight = previous?.let { it.bottom - it.top } ?: 0
          val shouldReusePrevious = (rawWidth <= 0 || rawHeight <= 0) &&
            previousWidth > 0 &&
            previousHeight > 0 &&
            !stickyFrameCarryover.contains(node.id)

          val appliedFrame = if (shouldReusePrevious && previous != null) {
            stickyNodesForRelayout.add(node.id)
            stickyFramesUsedThisFrame.add(node.id)
            previous
          } else {
            stickyFrameCarryover.remove(node.id)
            rawFrame
          }
          appliedFrames.put(node.id, appliedFrame)
          val parentId = parents[node.id]
          val parentType = parentId?.let { nodes.get(it)?.type }
          if (
            DEBUG_SCROLL_LAYOUT &&
            (node.type == SCROLL_VIEW_TYPE || parentType == SCROLL_VIEW_TYPE)
          ) {
            val vg = node.view as? ViewGroup
            val childCount = vg?.childCount ?: -1
            if (isNativeDebugEnabled()) {
              Log.d(
                "RuneUI",
                "[layout] node=${node.id} type=${node.type} parentType=$parentType raw=(${rawFrame.left},${rawFrame.top},${rawFrame.right},${rawFrame.bottom}) applied=(${appliedFrame.left},${appliedFrame.top},${appliedFrame.right},${appliedFrame.bottom}) children=$childCount reused=$shouldReusePrevious"
              )
            }
          }

          val width = (appliedFrame.right - appliedFrame.left).coerceAtLeast(0)
          val height = (appliedFrame.bottom - appliedFrame.top).coerceAtLeast(0)

          val layoutParams = when (val current = node.view.layoutParams) {
            is FrameLayout.LayoutParams -> current
            else -> FrameLayout.LayoutParams(width.coerceAtLeast(0), height.coerceAtLeast(0))
          }

          var paramsChanged = false
          if (layoutParams.width != width) {
            layoutParams.width = width
            paramsChanged = true
          }
          if (layoutParams.height != height) {
            layoutParams.height = height
            paramsChanged = true
          }
          if (layoutParams.leftMargin != appliedFrame.left) {
            layoutParams.leftMargin = appliedFrame.left
            paramsChanged = true
          }
          if (layoutParams.topMargin != appliedFrame.top) {
            layoutParams.topMargin = appliedFrame.top
            paramsChanged = true
          }
          if (layoutParams.gravity != (Gravity.START or Gravity.TOP)) {
            layoutParams.gravity = Gravity.START or Gravity.TOP
            paramsChanged = true
          }
          if (paramsChanged) {
            node.view.layoutParams = layoutParams
          }

          // Ensure the measured dimensions stay in sync with Yoga so scroll containers pick up correct sizes.
          val targetWidthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
          val targetHeightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
          if (
            node.view.measuredWidth != width ||
            node.view.measuredHeight != height
          ) {
            node.view.measure(targetWidthSpec, targetHeightSpec)
          }
        }

        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (isVirtualTextNode(node)) continue
          val appliedFrame = appliedFrames.get(node.id) ?: engine.frame(node.id)
          node.view.layout(appliedFrame.left, appliedFrame.top, appliedFrame.right, appliedFrame.bottom)
          if (node.type != TEXT_TYPE) {
            node.label?.layout(0, 0, appliedFrame.right - appliedFrame.left, appliedFrame.bottom - appliedFrame.top)
          }
        }

        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (isVirtualTextNode(node)) continue
          val appliedFrame = appliedFrames.get(node.id) ?: engine.frame(node.id)
          val hasSize = (appliedFrame.right - appliedFrame.left) > 0 && (appliedFrame.bottom - appliedFrame.top) > 0
          node.view.visibility = if (hasSize) View.VISIBLE else View.INVISIBLE
          if (hasSize) {
            node.label?.alpha = 1f
          }
        }
        stickyFrameCarryover.clear()
        stickyFrameCarryover.addAll(stickyFramesUsedThisFrame)
        if (stickyNodesForRelayout.isNotEmpty()) {
          stickyRelayoutNodes.addAll(stickyNodesForRelayout)
        }
        PerformanceProfiler.recordRenderEnd()
      } while (dirty || pendingNativeOperations.isNotEmpty() || pendingViewOperations.isNotEmpty())
      if (stickyRelayoutNodes.isNotEmpty()) {
        stickyRelayoutNodes.forEach { engine.markDirty(it) }
      }
    } finally {
      root.suppressLayoutCompat(false)
      layoutTransactionActive = false
      val hasPendingOperations = dirty || pendingNativeOperations.isNotEmpty() || pendingViewOperations.isNotEmpty()
      when {
        stickyRelayoutNodes.isNotEmpty() -> scheduleFlush(FlushPriority.HIGH)
        hasPendingOperations -> scheduleFlush()
      }
    }
  }

  private fun drainPendingTextRebuilds() {
    if (pendingTextRebuild.isEmpty()) return
    val toProcess = pendingTextRebuild.toList()
    pendingTextRebuild.clear()
    toProcess.forEach { nodeId ->
      val node = nodes.get(nodeId) ?: return@forEach
      if (node.type != TEXT_TYPE) return@forEach
      val newText = recomputeTextForNode(node)
      node.cachedText = newText
      node.label?.text = newText
      (node.view as? TextView)?.text = newText
    }
  }

  private fun resolveTextNode(id: Int): Node? {
    var currentId: Int? = id
    while (currentId != null) {
      val node = nodes.get(currentId)
      if (node?.label != null || node?.view is TextView) return node
      currentId = parents[currentId]
    }
    return nodes.get(id)
  }

  private fun removeNodeRecursive(id: Int, detachView: Boolean = true) {
    if (id == root.rootId) return
    
    val node = nodes.get(id)
    if (node == null) {
        // Node may have been removed earlier (e.g., merged text child).
        // Ensure we still clear parent mapping to avoid stale references.
        parents.remove(id)
        return
    }

    // First, recursively remove all children
    val childrenToRemove = parents.entries.filter { it.value == id }.map { it.key }
    childrenToRemove.forEach { childId ->
        removeNodeRecursive(childId, detachView)
    }

    // Clean up from parent's textChildren if this is a text child
    node.parentId?.let { parentId ->
        nodes.get(parentId)?.textChildren?.remove(id)
    }

    if (node.type == IMAGE_TYPE) {
        imageSupport.cleanup(node)
    }
    if (node.type == TEXT_INPUT_TYPE || node.type == SECURE_TEXT_INPUT_TYPE) {
        cleanupTextInput(node)
    }
    if (node.type == SCROLL_VIEW_TYPE) {
        (node.view as? RuneScrollView)?.unbind()
    }
    if (node.type == BUTTON_TYPE) {
        buttonStyles.remove(id)
    }

    // Clean up view: remove click listener and from parent
    node.view.setOnClickListener(null)
    node.view.isClickable = false
    if (detachView) {
      (node.view.parent as? ViewGroup)?.removeView(node.view)
    }
    
    // Clean up layout engine
    engine.setMeasureHandler(id, null)
    engine.removeNode(id)
    
    // Remove from our tracking maps
    nodes.remove(id)
    parents.remove(id)
    node.parentId = null
    
    // Also clean up from any pending text rebuilds
    pendingTextRebuild.remove(id)
  }

  private fun ViewGroup.suppressLayoutCompat(shouldSuppress: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
      suppressLayout(shouldSuppress)
    }
  }

  private fun detachChildView(parentId: Int, childNode: Node) {
    val expectedParentView = when {
      parentId == root.rootId -> root
      else -> nodes.get(parentId)?.view as? ViewGroup
    }
    val childView = childNode.view

    var wasRemoved = false
    if (expectedParentView != null) {
      val index = expectedParentView.indexOfChild(childView)
      if (index >= 0) {
        expectedParentView.removeViewAt(index)
        wasRemoved = true
      }
    }

    if (!wasRemoved) {
      val actualParent = childView.parent as? ViewGroup
      if (actualParent != null) {
        actualParent.removeView(childView)
        wasRemoved = true
      }
    }

    if (!wasRemoved) {
      Log.w(
        "RuneUI",
        "detachChildView: unable to locate view for node ${childNode.id} under parent $parentId; view may already be detached",
      )
    }
  }

  companion object {
    private const val TEXT_TYPE = "text"
    private const val IMAGE_TYPE = "image"
    private const val TEXT_INPUT_TYPE = "text-input"
    private const val SECURE_TEXT_INPUT_TYPE = "secure-text-input"
    private const val SCROLL_VIEW_TYPE = "scroll-view"
    private const val BUTTON_TYPE = "button"
    private const val PRESSABLE_TYPE = "pressable"
    private var testIdWarningLogged = false
    private val TEXT_INPUT_MEASURE_PROPS = setOf(
      "style",
      "multiline",
      "numberOfLines",
      "maxLength",
      "secureTextEntry",
      "inputMode",
      "autoCapitalize",
      "autoCorrect",
      "spellCheck",
      "editable",
      "placeholder",
      "selection",
      "selectionColor",
      "caretColor",
      "eventThrottleMs",
      "allowProgrammaticJumpDuringEdit",
      "returnKeyType",
      "blurOnSubmit",
      "submitBehavior",
    )
  }
}
