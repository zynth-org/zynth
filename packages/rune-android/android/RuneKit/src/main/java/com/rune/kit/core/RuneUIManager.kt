package com.rune.kit.core

import android.graphics.Color
import android.graphics.Typeface
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
import java.util.HashMap
import java.util.LinkedHashSet
import java.util.concurrent.CountDownLatch
import kotlin.math.roundToInt
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

class RuneUIManager(
  private val root: RuneRootView,
  private val engine: LayoutEngine,
  private val eventDispatcher: (Int, String) -> Unit = { _, _ -> },
  private val handlerListener: (Int, String, Long) -> Unit = { _, _, _ -> },
) : JSBridge.UIShim {
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
  )

  data class SelectionSpec(var start: Int, var end: Int)

  data class TextInputState(
    var defaultValue: String = "",
    var currentText: String = "",
    var awaitingInitialValue: Boolean = true,
    var hasAppliedInitialText: Boolean = false,
    var pendingSelection: SelectionSpec? = null,
  )

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
  private val eventPayloads = HashMap<String, JSONObject>()
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

  private fun eventKey(nodeId: Int, event: String): String = "$nodeId::$event"

  private fun storeEventPayload(nodeId: Int, event: String, payload: JSONObject?) {
    val key = eventKey(nodeId, event)
    synchronized(eventPayloads) {
      if (payload != null && payload.length() > 0) {
        eventPayloads[key] = payload
      } else {
        eventPayloads.remove(key)
      }
    }
  }

  fun consumeEventPayload(nodeId: Int, event: String): JSONObject? {
    val key = eventKey(nodeId, event)
    synchronized(eventPayloads) {
      return eventPayloads.remove(key)?.let {
        try {
          JSONObject(it.toString())
        } catch (_: JSONException) {
          null
        }
      }
    }
  }

  fun dequeueEventPayloadJson(nodeId: Int, event: String): String? {
    val key = eventKey(nodeId, event)
    synchronized(eventPayloads) {
      val payload = eventPayloads.remove(key)
      return payload?.toString()
    }
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
      Log.d("RuneUI", "Created text node $id")
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
    var left = view.paddingLeft
    var top = view.paddingTop
    var right = view.paddingRight
    var bottom = view.paddingBottom

    fun Float?.asPx(): Int? = this?.roundToInt()?.coerceAtLeast(0)

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

    val changed = left != view.paddingLeft || top != view.paddingTop || right != view.paddingRight || bottom != view.paddingBottom
    if (changed) {
      view.setPadding(left, top, right, bottom)
      engine.markDirty(nodeId)
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
      "clearButtonMode" -> {
        Log.d("RuneUI", "clearButtonMode is not supported on Android; ignoring value: $parsed")
        true
      }
      "showClearAccessory" -> {
        Log.d("RuneUI", "showClearAccessory is not supported on Android; ignoring value: $parsed")
        true
      }
      else -> false
    }
  }

  private fun measureTextInput(view: RuneTextInputView, input: MeasureInput): Pair<Float, Float> {
    val widthSpec = when (input.widthMode) {
      MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(
        when {
          input.width.isNaN() -> 0
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        },
        MeasureSpec.EXACTLY,
      )
      MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(
        when {
          input.width.isNaN() -> Int.MAX_VALUE / 2
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        },
        MeasureSpec.AT_MOST,
      )
      MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
    }
    val heightSpec = when (input.heightMode) {
      MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(
        when {
          input.height.isNaN() -> 0
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        },
        MeasureSpec.EXACTLY,
      )
      MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(
        when {
          input.height.isNaN() -> Int.MAX_VALUE / 2
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        },
        MeasureSpec.AT_MOST,
      )
      MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
    }

    view.measure(widthSpec, heightSpec)
    val targetWidth = if (input.widthMode == MeasureMode.EXACTLY) {
      MeasureSpec.getSize(widthSpec)
    } else {
      view.measuredWidth
    }.coerceAtLeast(1)

    val minHeight = if (view.lineCount == 0) view.lineHeight else view.lineHeight * view.lineCount
    val targetHeight = if (input.heightMode == MeasureMode.EXACTLY) {
      MeasureSpec.getSize(heightSpec)
    } else {
      view.measuredHeight.coerceAtLeast(minHeight)
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
    storeEventPayload(nodeId, event, payload)
    eventDispatcher(nodeId, event)
  }

  internal fun onTextInputTextUpdated(nodeId: Int, text: String) {
    val node = nodes.get(nodeId) ?: return
    val state = ensureTextInputState(node)
    state.currentText = text
    state.hasAppliedInitialText = true
    state.awaitingInitialValue = false
    node.cachedText = text
    state.pendingSelection?.let { pending ->
      val inputView = node.view as? RuneTextInputView
      if (inputView != null) {
        inputView.post {
          inputView.applySelection(pending.start, pending.end)
          state.pendingSelection = null
        }
      }
    }
  }

  internal fun onTextInputIntrinsicSizeChanged(nodeId: Int) {
    engine.markDirty(nodeId)
    scheduleFlush()
  }

  override fun setProp(nodeId: Int, name: String, jsonValue: String?) = onMain {
    Log.d("RuneUI", "setProp: nodeId=$nodeId name=$name jsonValue=$jsonValue")
    val valueJson = jsonValue
    // Resolve target even if the original node was merged/removed (e.g., text child inside Text)
    val direct = nodes.get(nodeId)
    val target = when {
      direct != null && (direct.label != null || direct.view is TextView) -> direct
      else -> resolveTextNode(nodeId) ?: direct
    } ?: run {
      Log.w("RuneUI", "setProp: nodeId=$nodeId not found and no text ancestor; skipping prop '$name'")
      return@onMain
    }
    if (target.type == TEXT_INPUT_TYPE || target.type == SECURE_TEXT_INPUT_TYPE) {
      if (handleTextInputProp(target, name, valueJson)) {
        scheduleFlush()
        return@onMain
      }
    }

    when (name) {
      "style" -> {
        val styleValue = valueJson ?: return@onMain
        val style = Style.fromJson(styleValue)
        engine.setStyle(target.id, style)
        // If styling a merged child, clear any residual style on the original id in the layout engine
        if (target.id != nodeId) {
          engine.setStyle(nodeId, Style())
        }
        (target.label ?: target.view as? TextView)?.let { textView ->
          style.fontSize?.let { textView.textSize = it }
          style.color?.let { textView.setTextColor(it) }
          style.fontWeight?.let { weight ->
            val isBold = weight.equals("bold", ignoreCase = true) ||
              weight.toFloatOrNull()?.let { it >= 600f } == true
            textView.typeface = if (isBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
          }
        }
        style.backgroundColor?.let { target.view.setBackgroundColor(it) }
        style.borderRadius?.let { radius ->
          target.view.clipToOutline = true
          target.view.outlineProvider = RoundedOutline(radius)
        }
        if (target.type == IMAGE_TYPE) {
          imageSupport.onStyleApplied(target, style)
        }
        if (target.view is RuneTextInputView) {
          applyTextInputStyle(target.view as RuneTextInputView, style, target.id)
        }
      }
      "onPress" -> {
        // onPress should be handled by the JavaScript bridge calling setHandler
        // This is just for logging
        Log.d("RuneUI", "onPress prop set for node $nodeId, expecting setHandler call")
      }
      "accessibilityLabel" -> {
        target.view.contentDescription = parseString(jsonValue)
      }
      "accessibilityHint" -> {
        Log.w("RuneUI", "accessibilityHint is not a supported concept on Android and will be ignored.")
      }
      "accessibilityRole" -> {
        val role = parseString(jsonValue)
        ViewCompat.setAccessibilityDelegate(target.view, object : AccessibilityDelegateCompat() {
          override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
            super.onInitializeAccessibilityNodeInfo(host, info)
            when (role) {
              "button" -> info.className = Button::class.java.name
              "header" -> info.isHeading = true
              "none" -> ViewCompat.setImportantForAccessibility(host, ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_NO)
              else -> { // Default to auto if not explicitly 'none'
                if (ViewCompat.getImportantForAccessibility(host) == ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_NO) {
                  ViewCompat.setImportantForAccessibility(host, ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_AUTO)
                }
              }
            }
          }
        })
      }
      "pointerEvents" -> {
        val value = parseString(jsonValue) ?: "auto"
        target.pointerEvents = value // Store the value
        when (value) {
          "none" -> {
            target.view.isClickable = false
            target.view.isFocusable = false
          }
          else -> { // "auto" and others
            target.view.isFocusable = true
            // If an onPress handler is already attached, ensure it's clickable.
            if (target.view.hasOnClickListeners()) {
              target.view.isClickable = true
            }
          }
        }
      }
      "testID" -> {
        Log.w("RuneUI", "testID is not a recommended pattern on Android as it can conflict with accessibility. It will be ignored.")
      }
      else -> {
        if (target.type == IMAGE_TYPE && imageSupport.handleProp(target, name, jsonValue)) {
          scheduleFlush()
          return@onMain
        }
        Log.d("RuneUI", "Unhandled prop: $name = $valueJson")
      }
    }
    scheduleFlush()
  }

  override fun setText(nodeId: Int, text: String) = onMain {
    Log.d("RuneUI", "setText nodeId=$nodeId text='$text'")
    val node = nodes.get(nodeId)
    node?.cachedText = text

    val target = resolveTextNode(nodeId)
    if (target == null) {
      Log.w("RuneUI", "setText: could not resolve target for nodeId=$nodeId")
    }

    when {
      target?.type == TEXT_TYPE -> {
        pendingTextRebuild.add(target.id)
        engine.markDirty(target.id)
        propagateTextChange(target)
        Log.d("RuneUI", "Set text on label: ${target.label?.text}")
      }
      target?.view is RuneTextInputView -> {
        val input = target.view as RuneTextInputView
        input.performProgrammaticUpdate {
          if (!text.contentEquals(input.text?.toString())) {
            input.setText(text)
          }
        }
        onTextInputTextUpdated(target.id, text)
        Log.d("RuneUI", "Set text on input view: ${input.text}")
      }
      target?.view is TextView -> {
        (target.view as TextView).text = text
        engine.markDirty(target.id)
        Log.d("RuneUI", "Set text on view: ${(target.view as TextView).text}")
      }
      else -> {
        engine.markDirty(target?.id ?: nodeId)
      }
    }
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
    val parentView: View = if (parentId == root.rootId) {
      root
    } else {
      nodes.get(parentId)?.view ?: return@onMain
    }
    val node = nodes.get(childId)
    if (node == null) {
      Log.w("RuneUI", "removeChild: node $childId not found for parent $parentId")
      return@onMain
    }
    val childView = node.view

    if (parentView is ViewGroup) {
      val safeIndex = index.coerceIn(0, parentView.childCount)
      parentView.addView(childView, safeIndex)
    }
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
    // For non-text parents, clear mapping early
    parents[childId] = null
    nodes.get(childId)?.parentId = null
    val childView = nodes.get(childId)?.view ?: return@onMain

    (childView.parent as? ViewGroup)?.removeView(childView)
    engine.setMeasureHandler(childId, null)
    engine.removeNode(childId)
    scheduleFlush()
    parents.remove(childId)
    nodes.remove(childId)
  }

  override fun setHandler(nodeId: Int, event: String, handlerId: Long) = onMain {
    nodes.get(nodeId)?.let { node ->
      (node.view as? RuneTextInputView)?.let { input ->
        when (event) {
          "onChange" -> input.hasOnChange = true
          "onChangeText" -> input.hasOnChangeText = true
          "onSelectionChange" -> input.hasOnSelectionChange = true
          "onFocus" -> input.hasOnFocus = true
          "onBlur" -> input.hasOnBlur = true
          "onSubmitEditing" -> input.hasOnSubmitEditing = true
          "onKeyPress" -> input.hasOnKeyPress = true
          "onCompositionStart" -> input.hasOnCompositionStart = true
          "onCompositionEnd" -> input.hasOnCompositionEnd = true
        }
      }
      if (node.type == IMAGE_TYPE) {
        imageSupport.onHandlerSet(node, event)
      }
    }
    if (event == "onPress") {
      Log.d("RuneUI", "Setting onPress handler for node $nodeId")
      val node = nodes.get(nodeId)
      node?.view?.let { view ->
        // Make the view clickable only if pointerEvents allows it
        if (node.pointerEvents != "none") {
          view.isClickable = true
        }
        view.setOnClickListener {
          Log.d("RuneUI", "onPress triggered for node $nodeId")
          eventDispatcher(nodeId, event)
        }
      }
    }
    handlerListener(nodeId, event, handlerId)
  }

  override fun removeNode(nodeId: Int) = onMain {
    removeNodeRecursive(nodeId)
    scheduleFlush()
  }

  fun hasRenderableContent(): Boolean = onMain { nodes.size() > 0 }

  fun clearAllNodes() = onMain {
    Log.d("RuneUI", "Clearing all nodes for dev reload")
    frameScheduler.cancelFlush()
    handler.removeCallbacksAndMessages(null)
    pendingTextRebuild.clear()
    eventPayloads.clear()
    dirty = false

    for (i in nodes.size() - 1 downTo 0) {
      val node = nodes.valueAt(i)
      if (node.id == root.rootId) continue
      imageSupport.cleanup(node)
      if (node.type == TEXT_INPUT_TYPE || node.type == SECURE_TEXT_INPUT_TYPE) {
        cleanupTextInput(node)
      }
      node.view.animate()?.cancel()
      node.view.clearAnimation()
      node.view.setOnClickListener(null)
      (node.view.parent as? ViewGroup)?.removeView(node.view)
      nodes.removeAt(i)
    }

    parents.clear()
    parents[root.rootId] = null
    nextId = root.rootId + 1
    lastRootWidth = -1
    lastRootHeight = -1

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
    if (root.width > 0 && root.height > 0) {
      frameScheduler.cancelFlush()
      performFlush()
    }
    else {
      scheduleFlush()
    }
  }

  private fun scheduleFlush() {
    dirty = true
    frameScheduler.scheduleFlush {
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
    if (root.width == 0 || root.height == 0) {
      handler.post { performFlush() }
      return
    }
    if (!dirty) return
    dirty = false

    PerformanceProfiler.recordLayoutStart()
    drainPendingTextRebuilds()
    // Store previous frames for existing nodes to detect layout jumps
    val previousFrames = SparseArray<Rect>()
    for (i in 0 until nodes.size()) {
      val node = nodes.valueAt(i)
      if (node.view.visibility == View.VISIBLE) {
        // Only track visible nodes that might jump
        previousFrames.put(node.id, Rect(
          node.view.left,
          node.view.top,
          node.view.right,
          node.view.bottom
        ))
      }
    }
    
    // Calculate layout first, before any visual changes
    engine.calculateLayout(root.width, root.height)
    PerformanceProfiler.recordLayoutEnd()

    PerformanceProfiler.recordRenderStart()
    // First pass: update layout params (size + margins) so Android's layout pass positions views correctly
    // even before we manually apply frames. This prevents the initial "stacked in top-left" flash.
    for (i in 0 until nodes.size()) {
      val node = nodes.valueAt(i)
      if (isVirtualTextNode(node)) continue
      val frame: Rect = engine.frame(node.id)
      val width = frame.right - frame.left
      val height = frame.bottom - frame.top
      
      val layoutParams = when (val current = node.view.layoutParams) {
        is FrameLayout.LayoutParams -> current
        else -> FrameLayout.LayoutParams(width.coerceAtLeast(0), height.coerceAtLeast(0))
      }

      var paramsChanged = false
      if (width >= 0 && layoutParams.width != width) {
        layoutParams.width = width
        paramsChanged = true
      }
      if (height >= 0 && layoutParams.height != height) {
        layoutParams.height = height
        paramsChanged = true
      }
      if (layoutParams.leftMargin != frame.left) {
        layoutParams.leftMargin = frame.left
        paramsChanged = true
      }
      if (layoutParams.topMargin != frame.top) {
        layoutParams.topMargin = frame.top
        paramsChanged = true
      }
      // Ensure we don't retain stale end/bottom margins that could offset layout unexpectedly
      if (layoutParams.gravity != (Gravity.START or Gravity.TOP)) {
        layoutParams.gravity = Gravity.START or Gravity.TOP
        paramsChanged = true
      }
      if (paramsChanged) {
        node.view.layoutParams = layoutParams
      }
    }
    
    // Second pass: animate position changes for existing views to prevent jumps
    for (i in 0 until nodes.size()) {
      val node = nodes.valueAt(i)
      if (isVirtualTextNode(node)) continue
      val frame: Rect = engine.frame(node.id)
      val prevFrame = previousFrames.get(node.id)
      
      // Apply layout directly without animation
      // We're keeping the position tracking to avoid jumps, but not animating the transition
      node.view.layout(frame.left, frame.top, frame.right, frame.bottom)
      
      // For text nodes, don't layout the label separately since view and label are the same object
      if (node.type != TEXT_TYPE) {
        node.label?.layout(0, 0, frame.right - frame.left, frame.bottom - frame.top)
      }
    }
    
    // Final pass: make all nodes visible with fade-in for new views
    // This creates a smooth transition when new elements are added
    handler.post {
      for (i in 0 until nodes.size()) {
        val node = nodes.valueAt(i)
        if (isVirtualTextNode(node)) continue
        val frame: Rect = engine.frame(node.id)
        
        // Only make visible if it has a valid size
        if ((frame.right - frame.left) > 0 && (frame.bottom - frame.top) > 0) {
          if (node.view.visibility != View.VISIBLE) {
            // Set proper layout params before making visible to ensure stable layout
            val width = frame.right - frame.left
            val height = frame.bottom - frame.top
            if (width > 0 && height > 0) {
              node.view.layoutParams.width = width
              node.view.layoutParams.height = height
            }
            
            // Make visible immediately without fade-in animation
            node.view.visibility = View.VISIBLE
          }
        }
        
        // Ensure text is visible
        node.label?.alpha = 1f
      }
      PerformanceProfiler.recordRenderEnd()
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

  private fun removeNodeRecursive(id: Int) {
    if (id == root.rootId) return
    val children = parents.entries.filter { it.value == id }.map { it.key }
    children.forEach { childId -> removeNodeRecursive(childId) }
    val node = nodes.get(id)
    if (node == null) {
      // Node may have been removed earlier (e.g., merged text child).
      // Ensure we still clear parent mapping to avoid stale references.
      parents.remove(id)
      return
    }

    if (node.type == IMAGE_TYPE) {
      imageSupport.cleanup(node)
    }
    if (node.type == TEXT_INPUT_TYPE || node.type == SECURE_TEXT_INPUT_TYPE) {
      cleanupTextInput(node)
    }

    node.parentId?.let { parentId ->
      nodes.get(parentId)?.textChildren?.remove(id)
    }
    node.parentId = null

    // Clean up view: remove click listener and from parent
    node.view.setOnClickListener(null)
    node.view.isClickable = false
    (node.view.parent as? ViewGroup)?.removeView(node.view)
    
    // Clean up layout engine
    engine.setMeasureHandler(id, null)
    engine.removeNode(id)
    
    // Remove from our tracking maps
    nodes.remove(id)
    parents.remove(id)
  }

  companion object {
    private const val TEXT_TYPE = "text"
    private const val IMAGE_TYPE = "image"
    private const val TEXT_INPUT_TYPE = "text-input"
    private const val SECURE_TEXT_INPUT_TYPE = "secure-text-input"
  }
}
