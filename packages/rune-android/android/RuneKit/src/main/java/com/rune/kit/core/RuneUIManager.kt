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
import android.view.View.OnLayoutChangeListener
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RunePressableEventListener
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
import org.json.JSONArray
import java.util.HashMap
import java.util.LinkedHashSet
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import kotlin.math.roundToInt

private const val DEBUG_SCROLL_LAYOUT = false

internal enum class FlushPriority { HIGH, NORMAL }

internal sealed class ViewOperation {
  data class Insert(val parentId: Int, val childId: Int, val index: Int) : ViewOperation()
  data class Remove(val parentId: Int, val node: RuneUIManager.Node) : ViewOperation()
}

internal sealed class NativeOperation {
  /**
   * Optimized SetProp operation that stores:
   * - Raw JSON string for fallback compatibility
   * - Pre-parsed value to avoid repeated parsing
   * - Property category for fast dispatch
   */
  data class SetProp(
    val nodeId: Int,
    val name: String,
    val jsonValue: String?,
    val parsedValue: Any? = null,
    val category: PropertyCategory = PropertyCategory.UNKNOWN,
  ) : NativeOperation()
  
  data class SetText(val nodeId: Int, val text: String) : NativeOperation()
  data class SetHandler(val nodeId: Int, val event: String, val handlerId: Long) : NativeOperation()
}

class RuneUIManager(
  private val root: RuneRootView,
  private val engine: LayoutEngine,
  private val eventDispatcher: (Int, String) -> Unit = { _, _ -> },
  private val handlerListener: (Int, String, Long) -> Unit = { _, _, _ -> },
) : JSBridge.UIShim, RunePressableEventListener {
  private val density: Float = root.resources.displayMetrics.density
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

  init {
    RuneComponentRegistry.ensureInitialized()
  }
  data class Node(
    val id: Int,
    val type: String,
    val view: View,
    val label: TextView? = null,
    val textChildren: MutableList<Int> = mutableListOf(),
    // children holds the list of direct child node ids (lazy: null when no children)
    var children: MutableList<Int>? = null,
    var index: Int = -1,
    var parentId: Int? = null,
    var cachedText: String = "",
    var imageState: ImageState? = null,
    var pointerEvents: String = "auto",
    var textInputState: TextInputState? = null,
    var hasCompletedInitialMount: Boolean = false,
    // Cache for frame dimensions to detect changes and support sticky frame reuse
    var measuredFrame: Rect? = null,
    var hasOnLayoutHandler: Boolean = false,
    var lastLayoutX: Int = Int.MIN_VALUE,
    var lastLayoutY: Int = Int.MIN_VALUE,
    var lastLayoutWidth: Int = -1,
    var lastLayoutHeight: Int = -1,
    var layoutListener: OnLayoutChangeListener? = null,
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

  private fun processPendingViewOperations() {
    layoutFlush.processPendingViewOperations()
  }

  private fun applySetProp(nodeId: Int, name: String, jsonValue: String?, category: PropertyCategory = PropertyCategory.UNKNOWN) {
    propApplier.applySetProp(nodeId, name, jsonValue, category)
  }

  private fun applySetText(nodeId: Int, text: String) {
    propApplier.applySetText(nodeId, text, ::propagateTextChange)
  }

  private fun applySetHandler(nodeId: Int, event: String, handlerId: Long) {
    propApplier.applySetHandler(nodeId, event, eventDispatcher, handlerListener, handlerId)
  }

  private val nodes = SparseArray<Node>()
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
  private val nodeRecyclingPool = NodeRecyclingPool(
    debugLogging = isNativeDebugEnabled(),
  )
  private val propApplier = RunePropApplier(
    nodes = nodes,
    engine = engine,
    density = density,
    imageSupport = imageSupport,
    logDebug = ::logDebug,
    resolveTextNode = ::resolveTextNode,
    onTextInputTextUpdated = ::onTextInputTextUpdated,
    storeEventPayload = ::storeEventPayload,
  )
  private val eventManager = RuneEventManager(
    nodes = nodes,
    engine = engine,
    eventDispatcher = eventDispatcher,
    handlerListener = handlerListener,
    eventPayloads = eventPayloads,
    ensureTextInputState = ::ensureTextInputState,
  )
  private val recyclerHost = RuneRecyclerHost()
  private val nodeFactory = RuneNodeFactory(
    root = root,
    nodes = nodes,
    engine = engine,
    imageSupport = imageSupport,
    pendingTextRebuild = pendingTextRebuild,
    nodeRecyclingPool = nodeRecyclingPool,
    getNextId = { nextId },
    incrementNextId = { nextId++ },
    scheduleFlush = { priority: FlushPriority -> layoutFlush.scheduleFlush(priority) },
    logDebug = ::logDebug,
    onTextInputIntrinsicSizeChanged = ::onTextInputIntrinsicSizeChanged,
    manager = this,
  )
  private val layoutFlush = RuneLayoutFlush(
    root = root,
    nodes = nodes,
    engine = engine,
    handler = handler,
    frameScheduler = frameScheduler,
    pendingNativeOperations = pendingNativeOperations,
    pendingViewOperations = pendingViewOperations,
    pendingTextRebuild = pendingTextRebuild,
    stickyFrameCarryover = stickyFrameCarryover,
    isVirtualTextNode = ::isVirtualTextNode,
    recomputeTextForNode = ::recomputeTextForNode,
    applySetProp = ::applySetProp,
    applySetText = ::applySetText,
    applySetHandler = ::applySetHandler,
    logDebug = ::logDebug,
    isNativeDebugEnabled = ::isNativeDebugEnabled,
  )
  @Volatile private var viewTransactionInProgress = false
  @Volatile private var layoutTransactionActive = false
  private var flushCoalesceScheduled = false
  private var pendingFlushPriority = FlushPriority.NORMAL
  private var nextId = root.rootId + 1
  @Volatile private var dirty = false
  private var lastRootWidth = -1
  private var lastRootHeight = -1
  
  // Performance tracking for operation queues
  private var maxViewOps = 0
  private var maxNativeOps = 0
  private var scheduleFlushCount = 0
  private var totalNodesCreated = 0
  private var totalNodesRemoved = 0

  init {
    // root has no parent by design; no global parents map needed
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

  // Child management helpers: lazily allocate children list on first attach
  private fun attachChild(parentId: Int, childId: Int, atIndex: Int = -1) {
    val parentNode = nodes.get(parentId)
    val childNode = nodes.get(childId)
    // still allow attaching even if node isn't created yet; parentId is set on child when created
    if (parentNode == null || childNode == null) {
      // fallback to setting parentId on the child Node if it exists
      nodes.get(childId)?.parentId = parentId
      return
    }

    if (parentNode.children == null) parentNode.children = ArrayList()
    val list = parentNode.children!!
    val insertPos = if (atIndex < 0 || atIndex > list.size) list.size else atIndex
    // remove existing occurrence (defensive)
    list.remove(childId)
    list.add(insertPos, childId)

    childNode.parentId = parentId
    childNode.index = insertPos

    // update indices of following siblings
    for (i in insertPos + 1 until list.size) {
      nodes.get(list[i])?.index = i
    }
  }

  private fun detachChild(parentId: Int, childId: Int) {
    val parentNode = nodes.get(parentId) ?: return
    val list = parentNode.children ?: return
    val idx = list.indexOf(childId)
    if (idx >= 0) {
      list.removeAt(idx)
      for (i in idx until list.size) {
        nodes.get(list[i])?.index = i
      }
      nodes.get(childId)?.parentId = null
      nodes.get(childId)?.index = -1
      if (list.isEmpty()) parentNode.children = null
    }
  }

  fun consumeEventPayload(nodeId: Int, event: String): JSONObject? {
    return eventManager.consumeEventPayload(nodeId, event)
  }

  fun dequeueEventPayloadJson(nodeId: Int, event: String): String? {
    return eventManager.dequeueEventPayloadJson(nodeId, event)
  }

  private fun isVirtualTextNode(node: Node): Boolean {
    return nodeFactory.isVirtualTextNode(node)
  }

  private fun recomputeTextForNode(node: Node?): String {
    return nodeFactory.recomputeTextForNode(node)
  }

  private fun propagateTextChange(node: Node) {
    nodeFactory.propagateTextChange(node)
  }

  private fun recomputeAndPropagate(node: Node) {
    nodeFactory.recomputeAndPropagate(node)
  }

  private fun ensureTextInputState(node: Node): TextInputState {
    return nodeFactory.ensureTextInputState(node)
  }

  private fun cleanupTextInput(node: Node) {
    nodeFactory.cleanupTextInput(node)
  }

  private fun resolveTextNode(id: Int): Node? {
    return nodeFactory.resolveTextNode(id)
  }

  private fun measureTextInput(view: RuneTextInputView, input: MeasureInput): Pair<Float, Float> {
    return nodeFactory.measureTextInput(view, input)
  }

  override fun createNode(type: String): Int = onMain {
    // RECYCLING DISABLED - causing bugs without fixing performance
    // The real issue is elsewhere (scroll offset updates, layout calculations)
    
    val createStart = android.os.SystemClock.elapsedRealtime()
    
    // Create new node from scratch
    val id = nodeFactory.createNode(type)
    
    totalNodesCreated++
    
    val createTime = android.os.SystemClock.elapsedRealtime() - createStart
    if (createTime > 10) {
      // Log.w("RunePerf", "⚠️ createNode took ${createTime}ms for type=$type (id=$id)")
    }
    
    // Warn if node count is growing too large
    if (nodes.size() > 400 && totalNodesCreated % 50 == 0) {
      // Log.e("RunePerf", "🚨 Node count: ${nodes.size()} (created: $totalNodesCreated, removed: $totalNodesRemoved, leaked: ${totalNodesCreated - totalNodesRemoved - nodes.size()})")
    }
    
    return@onMain id
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
      when (view.background) {
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

  internal fun emitTextInputEvent(nodeId: Int, event: String, payload: JSONObject?) {
    eventManager.emitTextInputEvent(nodeId, event, payload)
  }

  fun dispatchEvent(nodeId: Int, event: String, payload: JSONObject?) {
    eventManager.dispatchEvent(nodeId, event, payload)
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

  fun applyBatch(batchJson: String?) = onMain {
    if (batchJson.isNullOrBlank()) return@onMain
    val payload = runCatching { JSONObject(batchJson) }.getOrNull() ?: return@onMain
    val operations = payload.optJSONArray("operations") ?: return@onMain
    recyclerHost.onBatch(payload.optJSONObject("meta"), operations)

    var mutated = false
    for (i in 0 until operations.length()) {
      val op = operations.optJSONObject(i) ?: continue
      when (op.optString("type")) {
        "setProp" -> {
          val nodeId = op.optInt("nodeId", -1)
          if (nodeId < 0) continue
          val name = op.optString("name")
          if (name.isBlank()) continue
          val value = op.opt("value")
          val jsonValue = encodeBatchValue(value)
          val category = PropertyCategoryMap.getCategory(name)
          pendingNativeOperations.add(
            NativeOperation.SetProp(
              nodeId = nodeId,
              name = name,
              jsonValue = jsonValue,
              parsedValue = if (value === JSONObject.NULL) null else value,
              category = category,
            ),
          )
          mutated = true
        }
        "setText" -> {
          val nodeId = op.optInt("nodeId", -1)
          if (nodeId < 0) continue
          val value = op.opt("value")
          val text = when (value) {
            null, JSONObject.NULL -> ""
            else -> value.toString()
          }
          pendingNativeOperations.add(NativeOperation.SetText(nodeId, text))
          mutated = true
        }
      }
    }

    if (mutated) {
      scheduleFlush()
    }
  }

  private fun encodeBatchValue(value: Any?): String? {
    when (value) {
      null, JSONObject.NULL -> return null
      is JSONObject -> return value.toString()
      is JSONArray -> return value.toString()
      is Number, is Boolean, is String -> {
        val wrapped = JSONObject.wrap(value)
        return wrapped?.toString() ?: value.toString()
      }
      else -> {
        val wrapped = JSONObject.wrap(value)
        return wrapped?.toString()
      }
    }
  }

  override fun setProp(nodeId: Int, name: String, jsonValue: String?) = onMain {
    // Fast O(1) property categorization for optimized dispatch
    val category = PropertyCategoryMap.getCategory(name)
    
    // Optionally pre-parse value for certain categories (future optimization)
    // For now, we defer parsing until application
    val parsedValue: Any? = null
    
    // Deduplicate: remove any previous setProp for same node+property
    // Use reversed iteration for better performance when removing from end
    val iterator = pendingNativeOperations.listIterator(pendingNativeOperations.size)
    var removedCount = 0
    while (iterator.hasPrevious() && removedCount < 20) {
      val op = iterator.previous()
      if (op is NativeOperation.SetProp && op.nodeId == nodeId && op.name == name) {
        iterator.remove()
        break // Only one setProp per node+property needed
      }
      removedCount++
    }
    
    pendingNativeOperations.add(
      NativeOperation.SetProp(
        nodeId = nodeId,
        name = name,
        jsonValue = jsonValue,
        parsedValue = parsedValue,
        category = category
      )
    )
    scheduleFlush()
  }

  override fun setText(nodeId: Int, text: String) = onMain {
    // Deduplicate: remove any previous setText for same node
    // Use reversed iteration for better performance when removing from end
    val iterator = pendingNativeOperations.listIterator(pendingNativeOperations.size)
    var removedCount = 0
    while (iterator.hasPrevious() && removedCount < 10) {
      val op = iterator.previous()
      if (op is NativeOperation.SetText && op.nodeId == nodeId) {
        iterator.remove()
        break // Only one setText per node needed
      }
      removedCount++
    }
    
    pendingNativeOperations.add(NativeOperation.SetText(nodeId, text))
    scheduleFlush()
  }

  override fun insertChild(parentId: Int, childId: Int, index: Int) = onMain {
    attachChild(parentId, childId, index)
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
    // Track removal frequency
    if (totalNodesRemoved % 10 == 0 && totalNodesRemoved > 0) {
      // Log.i("RunePerf", "🗑️ removeChild called (total removed: $totalNodesRemoved, current nodes: ${nodes.size()})")
    }
    
    val parentNode = nodes.get(parentId)
    if (parentNode?.type == TEXT_TYPE) {
      parentNode.textChildren.remove(childId)
      detachChild(parentId, childId)
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
    
    totalNodesRemoved++
    
    pendingViewOperations.removeAll { op ->
      op is ViewOperation.Insert && op.parentId == parentId && op.childId == childId
    }
    
    // RECYCLING DISABLED - causing bugs without fixing performance
    // Normal removal and destruction
    pendingViewOperations.add(ViewOperation.Remove(parentId, childNode))
    nodeFactory.removeNodeRecursive(childId, detachView = false)
    scheduleFlush()
  }

  override fun setHandler(nodeId: Int, event: String, handlerId: Long) = onMain {
    pendingNativeOperations.add(NativeOperation.SetHandler(nodeId, event, handlerId))
    scheduleFlush()
  }

  override fun removeNode(nodeId: Int) = onMain {
    nodeFactory.removeNodeRecursive(nodeId)
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
        nodeFactory.removeNodeRecursive(nodeId)
    }

  // Final cleanup: clear children for root
  nodes.get(root.rootId)?.children?.clear()
    nextId = root.rootId + 1
    lastRootWidth = -1
    lastRootHeight = -1
    
    // Clear recycling pool to free memory
    nodeRecyclingPool.clear()

    engine.reset()
  }

  private fun runOnMainThread(block: () -> Unit) {
    layoutFlush.runOnMainThread(block)
  }

  override fun dequeueEventPayload(nodeId: Int, event: String): String? {
    return dequeueEventPayloadJson(nodeId, event)
  }

  override fun flush() = onMain {
    layoutFlush.flush()
  }

  private fun scheduleFlush(priority: FlushPriority = FlushPriority.NORMAL) {
    scheduleFlushCount++
    
    val viewOps = pendingViewOperations.size
    val nativeOps = pendingNativeOperations.size
    
    // Track peak queue sizes
    if (viewOps > maxViewOps) {
      maxViewOps = viewOps
      if (viewOps > 50 && viewOps % 10 == 0) { // Only log every 10 to reduce spam
        // Log.w("RunePerf", "📈 NEW MAX view operations: $maxViewOps (nodes: ${nodes.size()})")
      }
    }
    if (nativeOps > maxNativeOps) {
      maxNativeOps = nativeOps
      if (nativeOps > 100 && nativeOps % 25 == 0) { // Only log every 25 to reduce spam
        // Log.w("RunePerf", "📈 NEW MAX native operations: $maxNativeOps (nodes: ${nodes.size()})")
      }
    }
    
    // Warn if queues are growing large (less frequently to avoid log spam)
    if ((viewOps > 100 || nativeOps > 200) && scheduleFlushCount % 50 == 0) {
      // Log.e("RunePerf", "🚨 LARGE OPERATION QUEUES: view=$viewOps native=$nativeOps (schedule #$scheduleFlushCount)")
    }
    
    layoutFlush.scheduleFlush(priority)
  }

  /**
   * Debug method to log current recycling pool metrics.
   * Call this to see pool efficiency during development.
   */
  fun logRecyclingPoolMetrics() {
    if (!isNativeDebugEnabled()) return
    nodeRecyclingPool.logMetrics()
  }
  
  /**
   * Log performance statistics for debugging.
   */
  fun logPerformanceStats() {
    val nodeCountDiff = totalNodesCreated - totalNodesRemoved
    val expectedNodeCount = nodes.size()
    val leakedNodes = nodeCountDiff - expectedNodeCount
    
    Log.i("RunePerf", """
      📊 PERFORMANCE STATS:
        - scheduleFlush calls: $scheduleFlushCount
        - Peak view ops: $maxViewOps
        - Peak native ops: $maxNativeOps
        - Current nodes: ${nodes.size()}
        - Nodes created: $totalNodesCreated
        - Nodes removed: $totalNodesRemoved
        - Expected node count: $nodeCountDiff
        - Leaked nodes: $leakedNodes
        - Current view ops: ${pendingViewOperations.size}
        - Current native ops: ${pendingNativeOperations.size}
        - Flush stats: ${layoutFlush.totalFlushes} total, ${layoutFlush.slowFlushCount} slow (${if (layoutFlush.totalFlushes > 0) layoutFlush.slowFlushCount * 100 / layoutFlush.totalFlushes else 0}%)
        - Avg flush time: ${if (layoutFlush.totalFlushes > 0) layoutFlush.totalFlushTime / layoutFlush.totalFlushes else 0}ms
    """.trimIndent())
    
    if (leakedNodes > 50) {
      Log.e("RunePerf", "🚨 MEMORY LEAK DETECTED: $leakedNodes nodes not properly cleaned up!")
    }
  }

  /**
   * Get current recycling pool metrics.
   * Useful for telemetry or performance monitoring.
   */
  internal fun getRecyclingPoolMetrics(): NodeRecyclingPool.RecyclingMetrics {
    return nodeRecyclingPool.getMetrics()
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

  companion object {
    private const val TEXT_TYPE = "text"
    private const val IMAGE_TYPE = "image"
    private const val TEXT_INPUT_TYPE = "text-input"
    private const val SECURE_TEXT_INPUT_TYPE = "secure-text-input"
    private const val SCROLL_VIEW_TYPE = "scroll-view"
    private const val BUTTON_TYPE = "button"
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
