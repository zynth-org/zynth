package com.zynth.kit.core

import android.graphics.Typeface
import android.text.TextPaint
import android.os.Handler
import android.os.Looper
import androidx.core.graphics.Insets
import androidx.core.view.WindowInsetsCompat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewPropertyAnimator
import android.widget.TextView
import android.util.Log
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.layout.MeasureHandler
import com.zynth.kit.layout.MeasureInput
import com.zynth.kit.layout.MeasureMode
import com.zynth.kit.layout.Style
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.runtime.JSBridge
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.roundToInt

// TODO: Move this to a separate file or optimize
private const val TRACE_TAG = "ZynthUIManager"
internal const val AXON_LAYOUT_TAG = "ZynthAxonLayout"
private const val DEFAULT_PERSPECTIVE = 500f
private const val DEBUG_TEXT = false
private const val DEBUG_TEXT_DIRTY = false

private data class AxonFontKey(
  val family: String,
  val weight: Int,
  val italic: Boolean,
  val sizePxBits: Int,
)

internal data class AxonEnvironmentSnapshot(
  val density: Float,
  val fontScale: Float,
  val localeTag: String,
  val isRtl: Boolean,
  val viewportWidthPx: Int,
  val viewportHeightPx: Int,
  val safeInsetsPx: Insets,
)

private fun resolveTypedPropName(keyToken: Int, strings: Array<String?>): String {
  if (keyToken >= 0) {
    return strings.getOrNull(keyToken) ?: ""
  }
  return when (-keyToken) {
    1 -> "width"
    2 -> "height"
    3 -> "minWidth"
    4 -> "minHeight"
    5 -> "maxWidth"
    6 -> "maxHeight"
    7 -> "flex"
    8 -> "flexGrow"
    9 -> "flexShrink"
    10 -> "flexBasis"
    11 -> "top"
    12 -> "right"
    13 -> "bottom"
    14 -> "left"
    15 -> "padding"
    16 -> "paddingHorizontal"
    17 -> "paddingVertical"
    18 -> "paddingTop"
    19 -> "paddingRight"
    20 -> "paddingBottom"
    21 -> "paddingLeft"
    22 -> "margin"
    23 -> "marginHorizontal"
    24 -> "marginVertical"
    25 -> "marginTop"
    26 -> "marginRight"
    27 -> "marginBottom"
    28 -> "marginLeft"
    29 -> "gap"
    30 -> "rowGap"
    31 -> "columnGap"
    32 -> "aspectRatio"
    33 -> "flexDirection"
    34 -> "justifyContent"
    35 -> "alignItems"
    36 -> "alignSelf"
    37 -> "alignContent"
    38 -> "flexWrap"
    39 -> "position"
    40 -> "display"
    41 -> "overflow"
    42 -> "background"
    43 -> "backgroundImage"
    44 -> "backgroundColor"
    45 -> "borderColor"
    46 -> "borderStyle"
    47 -> "borderRadius"
    48 -> "borderWidth"
    49 -> "borderTopWidth"
    50 -> "borderRightWidth"
    51 -> "borderBottomWidth"
    52 -> "borderLeftWidth"
    53 -> "borderTopLeftRadius"
    54 -> "borderTopRightRadius"
    55 -> "borderBottomRightRadius"
    56 -> "borderBottomLeftRadius"
    57 -> "color"
    58 -> "fontSize"
    59 -> "fontWeight"
    60 -> "fontFamily"
    61 -> "fontStyle"
    62 -> "textAlign"
    63 -> "opacity"
    64 -> "elevation"
    65 -> "zIndex"
    66 -> "transform"
    67 -> "transformOrigin"
    68 -> "shadowColor"
    69 -> "shadowOpacity"
    70 -> "shadowRadius"
    71 -> "shadowOffset"
    72 -> "boxShadow"
    73 -> "lineHeight"
    74 -> "lineSpacing"
    75 -> "paragraphSpacing"
    76 -> "letterSpacing"
    77 -> "textDecorationLine"
    78 -> "textTransform"
    79 -> "minimumFontScale"
    80 -> "baselineShift"
    81 -> "hyphenation"
    82 -> "pointerEvents"
    83 -> "accessibilityLabel"
    84 -> "accessibilityHint"
    85 -> "accessibilityRole"
    86 -> "testID"
    87 -> "layout"
    88 -> "delayLongPressMs"
    89 -> "doublePressWindowMs"
    90 -> "enableDoublePress"
    91 -> "multiline"
    92 -> "numberOfLines"
    93 -> "maxLength"
    94 -> "editable"
    95 -> "secureTextEntry"
    96 -> "inputMode"
    97 -> "autoCapitalize"
    98 -> "autoCorrect"
    99 -> "spellCheck"
    100 -> "returnKeyType"
    101 -> "blurOnSubmit"
    102 -> "submitBehavior"
    103 -> "eventThrottleMs"
    104 -> "allowProgrammaticJumpDuringEdit"
    105 -> "value"
    106 -> "defaultValue"
    107 -> "placeholder"
    108 -> "selection"
    109 -> "selectionColor"
    110 -> "caretColor"
    111 -> "clearButtonMode"
    112 -> "showClearAccessory"
    113 -> "__scrollCommand"
    114 -> "direction"
    else -> ""
  }
}

class ZynthUIManager(internal val rootView: ZynthRootView) : ZynthEventSink {
  internal var runtimePtr: Long = 0L
  internal val mainHandler = Handler(Looper.getMainLooper())
  internal val density = rootView.resources.displayMetrics.density
  internal var axonEnvironment = AxonEnvironmentSnapshot(
    density = density,
    fontScale = rootView.resources.configuration.fontScale,
    localeTag = rootView.resources.configuration.locales[0]?.toLanguageTag() ?: "und",
    isRtl = rootView.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL,
    viewportWidthPx = rootView.resources.displayMetrics.widthPixels,
    viewportHeightPx = rootView.resources.displayMetrics.heightPixels,
    safeInsetsPx = Insets.NONE,
  )
  internal var nextId = 1
  internal val nodes = HashMap<Int, View>()
  internal val nodeStates = HashMap<Int, Node>()
  internal val parents = HashMap<Int, Int>()
  internal val children = HashMap<Int, MutableList<Int>>()
  internal val nodeSurfaces = HashMap<Int, Int>()
  internal val surfaceRoots = HashMap<Int, ViewGroup>()
  internal val dirtySurfaces = HashSet<Int>()
  internal val surfaceSizes = HashMap<Int, Pair<Int, Int>>()
  internal val surfaceLayoutListeners = HashMap<Int, View.OnLayoutChangeListener>()
  internal val surfaceFirstFrameListeners = HashMap<Int, MutableList<() -> Unit>>()
  internal val surfaceFirstFrameDispatched = HashSet<Int>()
  internal val surfaceFirstFramePending = HashSet<Int>()
  internal val ownedSurfaces = HashSet<Int>()
  internal var activeSurfaceId = 0
  internal val styleStates = HashMap<Int, ZynthViewStyleState>()
  internal val styleDirtyNodes = HashSet<Int>()
  internal val styleLayoutDirtyNodes = HashSet<Int>()
  internal val styleLayoutFrames = HashMap<Int, android.graphics.Rect>()
  internal val textStyleStates = HashMap<Int, ZynthTextStyleState>()
  internal val measureHandlers = HashMap<Int, MeasureHandler>()
  private val axonFontIds = HashMap<AxonFontKey, Int>()
  private val axonFontPaints = HashMap<Int, TextPaint>()
  internal val layoutStyleCache = HashMap<Int, MutableMap<String, Any?>>()
  internal val pointerEvents = HashMap<Int, String>()
  internal val pressNodes = HashSet<Int>()
  internal val longPressNodes = HashSet<Int>()
  internal val doublePressNodes = HashSet<Int>()
  internal val activePressNodes = HashSet<Int>()
  internal val longPressFired = HashSet<Int>()
  internal val longPressDurations = HashMap<Int, Double>()
  internal val doublePressWindows = HashMap<Int, Double>()
  internal val lastPressTimestamps = HashMap<Int, Double>()
  internal val pressLocalPoints = HashMap<Int, Pair<Float, Float>>()
  internal val pressScreenPoints = HashMap<Int, Pair<Float, Float>>()
  internal val longPressRunnables = HashMap<Int, Runnable>()
  internal val droppedBeforeCreation = HashSet<Int>()
  private val byteBufferPool = ArrayDeque<ByteBuffer>(16)
  
  private fun acquireByteBuffer(capacity: Int): ByteBuffer {
    synchronized(byteBufferPool) {
      if (byteBufferPool.isNotEmpty()) {
        val buffer = byteBufferPool.removeLast()
        if (buffer.capacity() >= capacity) {
          buffer.clear()
          return buffer
        }
      }
    }
    return ByteBuffer.allocateDirect(capacity.coerceAtLeast(16384)).order(ByteOrder.nativeOrder())
  }

  private fun releaseByteBuffer(buffer: ByteBuffer) {
    synchronized(byteBufferPool) {
      if (byteBufferPool.size < 16) {
        byteBufferPool.addLast(buffer)
      }
    }
  }

  internal val touchListeners = HashMap<Int, View.OnTouchListener>()
  internal val layoutNodes = ConcurrentHashMap.newKeySet<Int>()
  internal val layoutPending = ConcurrentHashMap.newKeySet<Int>()
  internal val layoutDirtyNodes = ConcurrentHashMap.newKeySet<Int>()
  internal val layoutFrames = HashMap<Int, android.graphics.Rect>()
  internal val layoutTransitionFrames = HashMap<Int, android.graphics.Rect>()
  internal val layoutEventBuffer = ArrayList<LayoutEvent>(64)
  internal var layoutPayloadBuffer = DoubleArray(320)

  internal data class LayoutEvent(
    val id: Int,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double
  )

  internal var choreographer: Choreographer? = null
  internal var frameCallbackPosted = false
  internal var needsLayout = false
  internal var frameInProgress = false
  internal var didWarmup = false
  internal var budgetOverruns = 0
  internal var lastLayoutMs = 0.0
  internal var lastFrameMs = 0.0
  internal var frameProfiler: ((Double, Double, Boolean, Int) -> Unit)? = null
  internal var firstMountCommitListener: (() -> Unit)? = null
  private var didDispatchFirstMountCommit = false
  internal val frameCallback = Choreographer.FrameCallback { handleFrame() }
  private data class TimerEntry(
    val handler: Handler,
    val runnable: Runnable,
  )
  private val timerEntries = HashMap<Int, TimerEntry>()
  private val animationFrameCallbacks = HashMap<Int, Choreographer.FrameCallback>()
  private var descriptorCacheNodeId: Int = Int.MIN_VALUE
  private var descriptorCacheType: String? = null
  private var descriptorCacheValue: ZynthComponentDescriptor? = null
  internal var jsHandler: Handler? = null
  private val mainQueue = ArrayDeque<() -> Unit>()
  private var mainQueueScheduled = false
  private val mainQueueLock = Any()
  private val mainQueueMaxOpsPerTick = 100000
  private val mainQueueMaxMsPerTick = 16.0
  internal val layoutApplyBudgetMs = 8.0
  internal val layoutApplyBudgetMinMs = 5.0
  internal val layoutApplyBudgetMaxMs = 12.0
  internal val layoutPhaseBudgetMinNs = 18_000_000L
  internal val layoutPhaseBudgetMaxNs = 30_000_000L
  internal var perfFrameCount = 0
  internal var perfLastLogMs = android.os.SystemClock.uptimeMillis()
  internal var perfLayoutMs = 0.0
  internal var perfStyleMs = 0.0
  internal var perfLayoutEventsMs = 0.0
  internal var perfMeasures = 0
  internal var perfChanged = 0
  internal var perfNodes = 0
  internal var perfSurfaces = 0
  internal var perfMaxLayoutMs = 0.0
  internal var perfMaxStyleMs = 0.0
  internal var perfMaxLayoutEventsMs = 0.0
  internal var perfMaxMeasureCount = 0
  internal var perfMaxChangedCount = 0
  internal var perfMaxNodes = 0
  internal var perfMaxSurfaces = 0
  private var batchDepth = 0
  private var batchNeedsLayout = false
  private var atomicCommitDepth = 0
  internal var atomicCommitPending = false
  var assetProvider: AssetProvider? = null

  fun scheduleTimer(runtimePtr: Long, timerId: Int, delayMs: Int, repeat: Boolean) {
    val timerHandler = jsHandler ?: mainHandler
    val runnable = object : Runnable {
      override fun run() {
        runOnJS {
          JSBridge.invokeTimer(runtimePtr, timerId)
        }
        if (repeat) {
          timerHandler.postDelayed(this, delayMs.toLong())
        } else {
          timerEntries.remove(timerId)
        }
      }
    }
    timerEntries[timerId] = TimerEntry(timerHandler, runnable)
    timerHandler.postDelayed(runnable, delayMs.toLong())
  }

  fun cancelTimer(timerId: Int) {
    timerEntries.remove(timerId)?.let { entry ->
      entry.handler.removeCallbacks(entry.runnable)
    }
  }

  fun scheduleAnimationFrame(runtimePtr: Long, callbackId: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { scheduleAnimationFrame(runtimePtr, callbackId) }
      return
    }
    ensureChoreographer()
    val callback = object : Choreographer.FrameCallback {
      override fun doFrame(frameTimeNanos: Long) {
        animationFrameCallbacks.remove(callbackId)
        val timestampMs = frameTimeNanos / 1_000_000.0
        runOnJS {
          JSBridge.invokeAnimationFrame(runtimePtr, callbackId, timestampMs)
        }
      }
    }
    animationFrameCallbacks[callbackId] = callback
    choreographer?.postFrameCallback(callback)
  }

  fun setSharedSignal(id: Int, value: Double) {
    if (runtimePtr == 0L) return
    JSBridge.setSharedSignal(runtimePtr, id, value)
  }

  fun getSharedSignal(id: Int): Double? {
    if (runtimePtr == 0L) return null
    val value = JSBridge.getSharedSignal(runtimePtr, id)
    return if (value.isNaN()) null else value
  }

  fun runInputHandlerWorklet(
    nodeId: Int,
    workletId: Int,
    currentText: String,
    newInput: String,
    proposedText: String,
  ): String? {
    if (runtimePtr == 0L || workletId <= 0) return null
    return runCatching {
      JSBridge.runInputHandlerOnUiRuntime(
        runtimePtr,
        workletId,
        currentText,
        newInput,
        proposedText,
      )
    }.getOrNull()
  }

  fun cancelAnimationFrame(callbackId: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { cancelAnimationFrame(callbackId) }
      return
    }
    animationFrameCallbacks.remove(callbackId)?.let {
      choreographer?.removeFrameCallback(it)
    }
  }

  data class Node(
    val id: Int,
    val type: String,
    val view: View,
    val label: TextView? = null,
    val textChildren: MutableList<Int> = mutableListOf(),
    var cachedText: String = "",
    var pointerEvents: String = "auto",
    val attachments: MutableMap<String, Any?> = mutableMapOf(),
    var mountHasVisualProps: Boolean = false,
    var mountAwaitingFirstProps: Boolean = false,
    var layoutTransition: LayoutTransitionConfig? = null,
    var layoutAnimator: ViewPropertyAnimator? = null,
  )

  init {
    activeSurfaceId = rootView.rootId
    registerSurfaceInternal(rootView.rootId, rootView, owned = false)
    rootView.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
      if (left != oldLeft || top != oldTop || right != oldRight || bottom != oldBottom) {
        markAllSurfacesDirty()
      }
    }
  }

  internal fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
      return
    }
    val shouldSchedule = synchronized(mainQueueLock) {
      mainQueue.addLast(block)
      if (!mainQueueScheduled) {
        mainQueueScheduled = true
        true
      } else {
        false
      }
    }
    if (shouldSchedule) {
      mainHandler.post { drainMainQueue() }
    }
  }

  private fun drainMainQueue() {
    val startNs = System.nanoTime()
    val queueSize = synchronized(mainQueueLock) { mainQueue.size }
    // If the queue is backed up, increase the budget to catch up and prevent memory growth.
    // Use a multi-tier budget to handle extreme churn.
    val maxMs = when {
      queueSize > 1000 -> mainQueueMaxMsPerTick * 4.0
      queueSize > 500 -> mainQueueMaxMsPerTick * 2.0
      else -> mainQueueMaxMsPerTick
    }
    var processed = 0
    while (processed < mainQueueMaxOpsPerTick) {
      val op = synchronized(mainQueueLock) {
        if (mainQueue.isEmpty()) {
          mainQueueScheduled = false
          return
        }
        mainQueue.removeFirst()
      }
      op()
      processed += 1
      val elapsedMs = (System.nanoTime() - startNs) / 1_000_000.0
      if (elapsedMs >= maxMs) {
        break
      }
    }
    val shouldContinue = synchronized(mainQueueLock) {
      if (mainQueue.isEmpty()) {
        mainQueueScheduled = false
        false
      } else {
        true
      }
    }
    if (shouldContinue) {
      mainHandler.post { drainMainQueue() }
    }
  }


  internal fun runOnJS(block: () -> Unit) {
    val handler = jsHandler
    if (handler == null) {
      block()
      return
    }
    if (Looper.myLooper() == handler.looper) {
      block()
    } else {
      handler.post(block)
    }
  }

  fun setJSHandler(handler: Handler?) {
    jsHandler = handler
  }

  fun setRuntimePtr(ptr: Long) {
    if (runtimePtr != ptr) {
      axonFontIds.clear()
      axonFontPaints.clear()
    }
    runtimePtr = ptr
  }

  fun setFrameProfiler(profiler: ((frameMs: Double, layoutMs: Double, overBudget: Boolean, nodeCount: Int) -> Unit)?) {
    setFrameProfilerInternal(profiler)
  }

  fun createNode(type: String): Int {
    val id = nextId++
    val create = {
      val startNs = System.nanoTime()
      if (droppedBeforeCreation.remove(id)) {
        // This node was dropped before it could be created. Skip.
        traceOp("createNodeSkip", type, startNs)
      } else {
        val descriptor = ZynthComponentRegistry.getDescriptor(type)
        val view = descriptor?.createView?.invoke(rootView.context, id) ?: run {
          if (type == "text") {
            TextView(rootView.context).apply { text = "" }
          } else {
            ZynthLayoutView(rootView.context)
          }
        }
        nodes[id] = view
        val node = Node(
          id = id,
          type = type,
          view = view,
          label = view as? TextView,
        )
        nodeStates[id] = node
        pointerEvents[id] = "auto"
        nodeSurfaces[id] = activeSurfaceId
        markSurfaceDirty(activeSurfaceId)
        descriptor?.onNodeCreated?.invoke(this, node)
        traceOp("createNode", type, startNs)
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      create()
    } else {
      runOnMain { create() }
    }
    return id
  }

  fun setProp(id: Int, name: String, value: Double) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { setProp(id, name, value) }
      return
    }
    val startNs = System.nanoTime()
    val view = nodes[id] ?: return
    val node = nodeStates[id]
    val descriptor = descriptorFor(node)
    
    val isLayoutProp = when (name) {
      "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
      "flex", "flexGrow", "flexShrink", "flexBasis", "top", "right", "bottom", "left",
      "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingRight",
      "paddingBottom", "paddingLeft", "margin", "marginHorizontal", "marginVertical",
      "marginTop", "marginRight", "marginBottom", "marginLeft", "gap", "rowGap",
      "columnGap", "aspectRatio" -> true
      else -> false
    }

    if (isLayoutProp) {
      val floatVal = value.toFloat()
      val scaled = if (name != "flex" && name != "flexGrow" && name != "flexShrink" && name != "aspectRatio") {
        dpToPx(floatVal)
      } else {
        floatVal
      }
      cacheYogaStyle(id, name, scaled)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value.toString())
      traceOp("setProp", node?.type, startNs)
      return
    }

    if (applyStyleProp(id, view, name, value)) {
      maybeNotifyStyle(descriptor, node, name, value.toString())
      traceOp("setProp", node?.type, startNs)
      return
    }

    setProp(id, name, value.toString())
  }

  fun setProp(id: Int, name: String, value: String?) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { setProp(id, name, value) }
      return
    }
    val startNs = System.nanoTime()
    val view = nodes[id] ?: return
    val node = nodeStates[id]
    val descriptor = descriptorFor(node)
    if (node != null && descriptor?.applyProperty?.invoke(node, name, value) == true) {
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node.type, startNs)
      return
    }
    if (applyStyleProp(id, view, name, value)) {
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "layout") {
      if (node != null) {
        node.layoutTransition = parseLayoutTransition(value)
        if (node.layoutTransition != null) {
          layoutTransitionFrames[id] = android.graphics.Rect(view.left, view.top, view.right, view.bottom)
        } else {
          layoutTransitionFrames.remove(id)
          node.layoutAnimator?.cancel()
          node.layoutAnimator = null
        }
      }
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "color" && view is TextView) {
      ZynthColorParser.parse(value)?.let { color ->
        view.setTextColor(color)
      }
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "pointerEvents") {
      if (value.isNullOrBlank()) {
        pointerEvents.remove(id)
        nodeStates[id]?.pointerEvents = "auto"
        ZynthPointerEvents.set(view, ZynthPointerEvents.Mode.AUTO)
      } else {
        pointerEvents[id] = value
        nodeStates[id]?.pointerEvents = value
        ZynthPointerEvents.set(view, ZynthPointerEvents.fromString(value))
      }
      updateInteractionState(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "delayLongPressMs") {
      val duration = value?.toDoubleOrNull()
      if (duration == null) {
        longPressDurations.remove(id)
      } else {
        longPressDurations[id] = duration
      }
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "doublePressWindowMs") {
      val window = value?.toDoubleOrNull()
      if (window == null) {
        doublePressWindows.remove(id)
      } else {
        doublePressWindows[id] = window
      }
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "enableDoublePress") {
      val enabled = value?.lowercase() == "true" || value == "1"
      if (enabled) {
        doublePressNodes.add(id)
      } else {
        doublePressNodes.remove(id)
      }
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "opacity") {
      val alpha = value?.toFloatOrNull() ?: return
      view.alpha = alpha
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontSize") {
      val size = value?.toFloatOrNull() ?: return
      textStyleStates.getOrPut(id) { ZynthTextStyleState() }.fontSizePx = dpToPx(size)
      view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, dpToPx(size))
      syncAxonTextMeasurement(id, view)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontWeight") {
      val weight = value ?: return
      val textState = textStyleStates.getOrPut(id) { ZynthTextStyleState() }
      textState.fontWeight = weight
      applyResolvedTextTypeface(view, textState)
      syncAxonTextMeasurement(id, view)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontStyle") {
      val textState = textStyleStates.getOrPut(id) { ZynthTextStyleState() }
      textState.fontStyle = value
      applyResolvedTextTypeface(view, textState)
      syncAxonTextMeasurement(id, view)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontFamily") {
      val textState = textStyleStates.getOrPut(id) { ZynthTextStyleState() }
      textState.fontFamily = value
      applyResolvedTextTypeface(view, textState)
      syncAxonTextMeasurement(id, view)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "textAlign") {
      val gravity = when (value) {
        "center" -> Gravity.CENTER_HORIZONTAL
        "right" -> Gravity.END
        "left" -> Gravity.START
        else -> Gravity.START
      }
      view.gravity = gravity
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "width") {
      val scaled = scaleYogaValue(name, value)
      cacheYogaStyle(id, "width", scaled)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "height") {
      val scaled = scaleYogaValue(name, value)
      cacheYogaStyle(id, "height", scaled)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "flexDirection") {
      cacheYogaStyle(id, "flexDirection", value)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    val scaled = scaleYogaValue(name, value)
    cacheYogaStyle(id, name, scaled)
    markSurfaceDirtyForNode(id)
    maybeNotifyStyle(descriptor, node, name, value)
    traceOp("setProp", node?.type, startNs)
  }

  private fun parseLayoutTransition(raw: String?): LayoutTransitionConfig? {
    if (raw == null) return null
    val trimmed = raw.trim()
    if (trimmed.isEmpty() || trimmed == "null") return null
    if (trimmed == "true") {
      return LayoutTransitionConfig(
        type = "linear",
        durationMs = 300L,
        delayMs = 0L,
        easing = LayoutEasing.EASE_OUT_CUBIC,
      )
    }
    if (trimmed == "false") return null

    val parsed = runCatching { JSONTokener(trimmed).nextValue() }.getOrNull() ?: return null
    val map = parsed as? JSONObject ?: return null
    val type = map.optString("type", "linear")
    val durationMs = map.optLong("duration", 300L)
    val delayMs = map.optLong("delay", 0L)
    val easingName = map.optString("easing", "")
    return LayoutTransitionConfig(
      type = type,
      durationMs = durationMs,
      delayMs = delayMs,
      easing = LayoutEasing.fromName(easingName),
    )
  }

  internal fun maybeStartLayoutTransition(
    nodeId: Int,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
  ) {
    val node = nodeStates[nodeId] ?: return
    val transition = node.layoutTransition ?: run {
      layoutTransitionFrames.remove(nodeId)
      return
    }
    if (transition.type != "linear") {
      layoutTransitionFrames.remove(nodeId)
      return
    }
    val current = android.graphics.Rect(left, top, right, bottom)
    val previous = layoutTransitionFrames[nodeId]
    layoutTransitionFrames[nodeId] = current
    if (previous == null) return

    val width = current.width()
    val height = current.height()
    if (width <= 0 || height <= 0) return

    val view = node.view
    val hasActiveTransform =
      node.layoutAnimator != null ||
        kotlin.math.abs(view.translationX) > 0.5f ||
        kotlin.math.abs(view.translationY) > 0.5f ||
        kotlin.math.abs(view.scaleX - 1f) > 0.01f ||
        kotlin.math.abs(view.scaleY - 1f) > 0.01f

    val prevWidth = if (hasActiveTransform) width * view.scaleX else previous.width().toFloat()
    val prevHeight = if (hasActiveTransform) height * view.scaleY else previous.height().toFloat()
    if (prevWidth <= 0f || prevHeight <= 0f) return

    val currentCenterX = current.left + width / 2f
    val currentCenterY = current.top + height / 2f
    val prevCenterX = if (hasActiveTransform) {
      previous.left + previous.width() / 2f + view.translationX
    } else {
      previous.left + previous.width() / 2f
    }
    val prevCenterY = if (hasActiveTransform) {
      previous.top + previous.height() / 2f + view.translationY
    } else {
      previous.top + previous.height() / 2f
    }

    val deltaX = prevCenterX - currentCenterX
    val deltaY = prevCenterY - currentCenterY
    val scaleX = prevWidth / width.toFloat()
    val scaleY = prevHeight / height.toFloat()

    if (abs(deltaX) < 0.5f && abs(deltaY) < 0.5f &&
      abs(scaleX - 1f) < 0.01f && abs(scaleY - 1f) < 0.01f
    ) {
      if (hasActiveTransform) {
        node.layoutAnimator?.cancel()
        node.layoutAnimator = null
        view.translationX = 0f
        view.translationY = 0f
        view.scaleX = 1f
        view.scaleY = 1f
      }
      return
    }

    node.layoutAnimator?.cancel()
    node.layoutAnimator = null

    view.translationX = deltaX
    view.translationY = deltaY
    view.scaleX = scaleX
    view.scaleY = scaleY

    val animator = view.animate()
      .translationX(0f)
      .translationY(0f)
      .scaleX(1f)
      .scaleY(1f)
      .setStartDelay(transition.delayMs.coerceAtLeast(0L))
      .setDuration(transition.durationMs.coerceAtLeast(0L))
      .setInterpolator(transition.easing.toInterpolator())
      .withEndAction { node.layoutAnimator = null }

    node.layoutAnimator = animator
    animator.start()
  }

  fun setText(id: Int, text: String) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { setText(id, text) }
      return
    }
    val startNs = System.nanoTime()
    val view = nodes[id]
    
    if (DEBUG_TEXT && text.isNotEmpty()) {
      val firstCode = text[0].code
      if (firstCode > 0xE000 || text.length > 1) {
        val hex = text.map { Integer.toHexString(it.code) }.joinToString(" ")
        val hasGlyph = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M && view is TextView) {
          view.typeface?.run {
            android.graphics.Paint().also { it.typeface = this }.hasGlyph(text)
          }
        } else "unknown"
        Log.d(TRACE_TAG, "setText($id): '$text' codes=[$hex] hasGlyph=$hasGlyph typeface=${(view as? TextView)?.typeface}")
      }
    }
    // Log.d("ZynthLifecycle", "setText id=$id len=${text.length}")
    
    val node = nodeStates[id]
    val descriptor = descriptorFor(node)
    val handledByDescriptor =
      if (node != null) descriptor?.applyProperty?.invoke(node, "text", text) == true else false
    if (!handledByDescriptor && view is TextView) {
      node?.cachedText = text
      applyTextValue(id, view, text)
      markSurfaceDirtyForNode(id)
    }
    traceOp("setText", node?.type, startNs)
  }

  fun syncTextInputState(id: Int, text: String, selectionStart: Int, selectionEnd: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { syncTextInputState(id, text, selectionStart, selectionEnd) }
      return
    }
    val view = nodes[id] ?: return
    val node = nodeStates[id] ?: return
    val descriptor = descriptorFor(node)
    
    if (descriptor?.onSyncInputState?.invoke(node, text, selectionStart, selectionEnd) == true) {
      return
    }

    // Default fallback if descriptor doesn't handle it
    if (view is android.widget.EditText) {
      view.setText(text)
      if (selectionStart >= 0 && selectionEnd >= 0) {
        val len = view.text?.length ?: 0
        view.setSelection(selectionStart.coerceIn(0, len), selectionEnd.coerceIn(0, len))
      }
    }
  }

  fun insertChild(parentId: Int, childId: Int, index: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { insertChild(parentId, childId, index) }
      return
    }
    val startNs = System.nanoTime()
    val child = nodes[childId] ?: return
    val parentState = nodeStates[parentId]
    val parentTextChildren = if (parentState?.type == "text") parentState.textChildren else null
    parentTextChildren?.removeAll { it == childId }
    val isSurfaceRoot = isSurfaceRootId(parentId)
    val surfaceId = when {
      isSurfaceRoot -> parentId
      parentId == 0 -> activeSurfaceId
      else -> nodeSurfaces[parentId] ?: activeSurfaceId
    }
    val parent = if (parentId == 0 || isSurfaceRoot) rootViewForSurface(surfaceId) else nodes[parentId]
    val previousParentId = parents[childId]
    if (previousParentId != null && previousParentId != parentId) {
      children[previousParentId]?.remove(childId as Any?)
      nodeStates[previousParentId]?.textChildren?.removeAll { it == childId }
    }
    (child.parent as? ViewGroup)?.removeView(child)
    parents[childId] = parentId
    val siblings = children.getOrPut(parentId) { mutableListOf() }
    val existingIndex = siblings.indexOf(childId)
    if (existingIndex >= 0) {
      siblings.removeAt(existingIndex)
    }
    val insertIndex = index.coerceIn(0, siblings.size)
    siblings.add(insertIndex, childId)
    parentTextChildren?.add(insertIndex.coerceIn(0, parentTextChildren.size), childId)
    val previousSurfaceId = nodeSurfaces[childId]
    if (previousSurfaceId != surfaceId) {
      moveSubtreeToSurface(childId, surfaceId, parentId, index)
    } else {
      nodeSurfaces[childId] = surfaceId
    }

    val descriptor = parentState?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (descriptor != null && nodeStates[childId] != null) {
      descriptor.onChildInserted(this, parentState!!, nodeStates[childId]!!, index)
    }

    if (parent is TextView && child is TextView) {
      // Text composition is handled by the descriptor via updateComposedText
      markSurfaceDirty(surfaceId)
      traceOp("insertChild", parentState?.type, startNs)
      return
    }
    val group = parent as? ViewGroup
    if (group == null) {
      markSurfaceDirty(surfaceId)
      return
    }
    val targetIndex = index.coerceIn(0, group.childCount)
    group.addView(child, targetIndex)
    val actualParent = child.parent as? ViewGroup ?: group
    if (siblings.size > 1) {
      // Keep draw order aligned with logical zIndex without relying on native Z/elevation.
      val ordered = siblings.mapIndexedNotNull { insertionIndex, siblingId ->
        val sibling = nodes[siblingId] ?: return@mapIndexedNotNull null
        if (sibling.parent !== actualParent) return@mapIndexedNotNull null
        val zIndex = styleStates[siblingId]?.zIndex ?: 0f
        Triple(sibling, zIndex, insertionIndex)
      }.sortedWith(compareBy<Triple<View, Float, Int>>({ it.second }, { it.third }))
      ordered.forEach { (sibling, _, _) ->
        sibling.bringToFront()
      }
      actualParent.invalidate()
    }
    markSurfaceDirty(surfaceId)
    traceOp("insertChild", parentState?.type, startNs)
  }

  fun removeChild(parentId: Int, childId: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { removeChild(parentId, childId) }
      return
    }
    val startNs = System.nanoTime()
    val child = nodes[childId] ?: return
    val parentState = nodeStates[parentId]
    
    val descriptor = parentState?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (descriptor != null && nodeStates[childId] != null) {
      descriptor.onChildRemoved(this, parentState!!, nodeStates[childId]!!)
    }

    nodeStates[parentId]?.textChildren?.removeAll { it == childId }
    children[parentId]?.remove(childId as Any?)
    detachNode(childId)
    parents.remove(childId)
    (child.parent as? ViewGroup)?.removeView(child)
    val surfaceId = nodeSurfaces[childId] ?: activeSurfaceId
    markSurfaceDirtyForNode(childId)
    traceOp("removeChild", parentState?.type, startNs)
  }

  fun dropNode(nodeId: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { dropNode(nodeId) }
      return
    }
    val startNs = System.nanoTime()
    val type = nodeStates[nodeId]?.type
    destroyNode(nodeId)
    traceOp("dropNode", type, startNs)
  }

  fun setHandler(id: Int, name: String) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { setHandler(id, name) }
      return
    }
    val startNs = System.nanoTime()
    val node = nodeStates[id]
    val descriptor = node?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (node != null && descriptor?.onSetHandler?.invoke(node, name) == true) {
      traceOp("setHandler", node.type, startNs)
      return
    }
    if (name == "onPress" || name == "onPressIn" || name == "onPressOut" ||
      name == "onLongPress" || name == "onDoublePress"
    ) {
      pressNodes.add(id)
      if (name == "onLongPress") {
        longPressNodes.add(id)
      }
      if (name == "onDoublePress") {
        doublePressNodes.add(id)
      }
      attachTouchListener(id)
      updateInteractionState(id)
      traceOp("setHandler", node?.type, startNs)
      return
    }
    if (name == "onLayout") {
      layoutNodes.add(id)
      layoutPending.add(id)
      requestLayout()
      traceOp("setHandler", node?.type, startNs)
      return
    }
    traceOp("setHandler", node?.type, startNs)
  }

  fun setInputHandler(id: Int, workletId: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { setInputHandler(id, workletId) }
      return
    }
    val node = nodeStates[id] ?: return
    val descriptor = ZynthComponentRegistry.getDescriptor(node.type)
    descriptor?.onSetInputHandler?.invoke(node, workletId)
  }

  fun clearInputHandler(id: Int) {
    setInputHandler(id, 0)
  }

  override fun dispatchEvent(nodeId: Int, event: String, payload: org.json.JSONObject?) {
    val json = payload?.toString()
    runOnJS {
      runCatching {
        JSBridge.invokeEvent(runtimePtr, nodeId, event, json)
      }
    }
  }

  fun getRootView(): ZynthRootView = rootView

  fun snapshot(options: JSONObject? = null): JSONObject {
    return buildScreenSnapshot(options)
  }

  fun applyKeyboardAvoidingAdjustment(
    nodeId: Int,
    behavior: String,
    overlapPx: Float,
    availableHeightPx: Float? = null
  ) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { applyKeyboardAvoidingAdjustment(nodeId, behavior, overlapPx, availableHeightPx) }
      return
    }
    if (behavior == "padding") {
      val value = if (overlapPx <= 0f) {
        getCachedFloat(nodeId, "paddingBottom")
      } else {
        getCachedFloat(nodeId, "paddingBottom") + overlapPx.coerceAtLeast(0f)
      }
      setAxonStyleNumber(nodeId, 20, value)
    } else if (behavior == "height") {
      val value = if (overlapPx <= 0f) {
        getCachedFloat(nodeId, "marginBottom")
      } else {
        getCachedFloat(nodeId, "marginBottom") + overlapPx.coerceAtLeast(0f)
      }
      setAxonStyleNumber(nodeId, 27, value)
    }
    markSurfaceDirtyForNode(nodeId)
  }

  private fun getCachedFloat(nodeId: Int, name: String): Float {
    val value = layoutStyleCache[nodeId]?.get(name) ?: return 0f
    return when (value) {
      is Float -> value
      is String -> value.toFloatOrNull() ?: 0f
      is Double -> value.toFloat()
      is Int -> value.toFloat()
      else -> 0f
    }
  }

  fun getNodeState(nodeId: Int): Node? = nodeStates[nodeId]

  fun getParentId(nodeId: Int): Int? = parents[nodeId]

  fun setSyncSignal(signalId: Int, value: String): Boolean {
    return JSBridge.setSyncSignal(runtimePtr, signalId, value)
  }

  fun getSyncSignal(signalId: Int): String? {
    val sb = StringBuilder()
    return if (JSBridge.getSyncSignal(runtimePtr, signalId, sb)) sb.toString() else null
  }

  fun setMeasureHandler(nodeId: Int, handler: MeasureHandler?) {
    if (handler == null) {
      measureHandlers.remove(nodeId)
    } else {
      measureHandlers[nodeId] = handler
    }
    if (usesAxonLayoutRuntime()) {
      JSBridge.axonSetMeasureHandler(runtimePtr, nodeId, handler != null)
    }
    if (handler != null) {
      markNodeDirty(nodeId)
    }
  }

  /**
   * Mark a node as dirty so its intrinsic size can be remeasured.
   * Used by components when text or content changes.
   */
  fun markNodeDirty(nodeId: Int) {
    if (DEBUG_TEXT_DIRTY) {
      Log.d("ZynthText", "markNodeDirty node=$nodeId\n${Throwable().stackTraceToString()}")
    }
    markSurfaceDirtyForNode(nodeId)
    requestLayout()
  }

  fun syncTextNodeMeasurement(nodeId: Int) {
    val textView = nodes[nodeId] as? TextView ?: return
    syncAxonTextMeasurement(nodeId, textView)
  }

  internal fun refreshAxonEnvironment(): AxonEnvironmentSnapshot {
    val metrics = rootView.resources.displayMetrics
    val configuration = rootView.resources.configuration
    val insets = rootView.rootWindowInsets?.let {
      WindowInsetsCompat.toWindowInsetsCompat(it, rootView)
    }?.getInsets(WindowInsetsCompat.Type.systemBars()) ?: Insets.NONE
    val viewportWidth = rootView.width.takeIf { it > 0 }
      ?: rootView.measuredWidth.takeIf { it > 0 }
      ?: metrics.widthPixels
    val viewportHeight = rootView.height.takeIf { it > 0 }
      ?: rootView.measuredHeight.takeIf { it > 0 }
      ?: metrics.heightPixels
    axonEnvironment = AxonEnvironmentSnapshot(
      density = metrics.density.takeIf { it > 0f } ?: 1f,
      fontScale = configuration.fontScale.takeIf { it > 0f } ?: 1f,
      localeTag = configuration.locales[0]?.toLanguageTag() ?: "und",
      isRtl = configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL,
      viewportWidthPx = viewportWidth,
      viewportHeightPx = viewportHeight,
      safeInsetsPx = insets,
    )
    return axonEnvironment
  }

  internal fun applyAxonEnvironmentToSurface(surfaceId: Int) {
    if (!usesAxonLayoutRuntime()) return
    val environment = refreshAxonEnvironment()
    setAxonStyleString(surfaceId, 114, if (environment.isRtl) "rtl" else "ltr")
    if (surfaceId == rootView.rootId) {
      surfaceSizes[surfaceId] = environment.viewportWidthPx to environment.viewportHeightPx
    }
  }

  fun bootstrapAxonEnvironment() {
    if (!usesAxonLayoutRuntime()) return
    val environment = refreshAxonEnvironment()
    setAxonStyleString(0, 114, if (environment.isRtl) "rtl" else "ltr")
    for (surfaceId in surfaceRoots.keys) {
      applyAxonEnvironmentToSurface(surfaceId)
    }
  }


  fun applyBatch(json: String) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { applyBatch(json) }
      return
    }
    json.length
  }

  fun applyBatchTypedPacked(ops: DoubleArray, strings: Array<String?>) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { applyBatchTypedPacked(ops, strings) }
      return
    }
    if (!didDispatchFirstMountCommit && ops.isNotEmpty()) {
      didDispatchFirstMountCommit = true
      runCatching { firstMountCommitListener?.invoke() }
    }
    beginBatch()
    try {
      var i = 0
      opLoop@ while (i < ops.size) {
        val opcode = ops[i++].toInt()
        when (opcode) {
          1 -> { // setProp
            if (i + 3 >= ops.size) break@opLoop
            val nodeId = ops[i++].toInt()
            val keyToken = ops[i++].toInt()
            val valueType = ops[i++].toInt()
            val payload = ops[i++]
            if (keyToken < 0 && applyTypedSetProp(nodeId, -keyToken, valueType, payload, strings)) {
              continue@opLoop
            }
            val key = resolveTypedPropName(keyToken, strings)
            if (key.isEmpty()) continue@opLoop
            if (valueType == 1) {
              setProp(nodeId, key, payload)
            } else {
              val value: String? = when (valueType) {
                2 -> strings.getOrNull(payload.toInt())
                3 -> if (payload != 0.0) "true" else "false"
                else -> null
              }
              setProp(nodeId, key, value)
            }
          }
          2 -> { // setText
            if (i + 1 >= ops.size) break@opLoop
            val nodeId = ops[i++].toInt()
            val textIndex = ops[i++].toInt()
            val text = strings.getOrNull(textIndex) ?: ""
            setText(nodeId, text)
          }
          3 -> { // insertChild
            if (i + 2 >= ops.size) break@opLoop
            val parentId = ops[i++].toInt()
            val childId = ops[i++].toInt()
            val index = ops[i++].toInt()
            insertChild(parentId, childId, index)
          }
          4 -> { // removeChild
            if (i + 1 >= ops.size) break@opLoop
            val parentId = ops[i++].toInt()
            val childId = ops[i++].toInt()
            removeChild(parentId, childId)
          }
          5 -> { // dropNode
            if (i >= ops.size) break@opLoop
            val nodeId = ops[i++].toInt()
            dropNode(nodeId)
          }
          else -> break@opLoop
        }
      }
    } finally {
      endBatch()
    }
  }

  fun applyBatchTypedBuffer(buffer: ByteBuffer, opCount: Int, strings: Array<String?>) {
    val ops = buffer.order(ByteOrder.nativeOrder())
    if (Looper.myLooper() != Looper.getMainLooper()) {
      val byteLength = opCount * 8
      val source = ops.duplicate().order(ByteOrder.nativeOrder())
      source.position(0)
      source.limit(byteLength.coerceAtMost(source.capacity()))
      val copied = acquireByteBuffer(byteLength)
      copied.put(source)
      copied.rewind()
      runOnMain { 
        applyBatchTypedBuffer(copied, opCount, strings)
        releaseByteBuffer(copied)
      }
      return
    }
    if (!didDispatchFirstMountCommit && opCount > 0) {
      didDispatchFirstMountCommit = true
      runCatching { firstMountCommitListener?.invoke() }
    }
    beginBatch()
    try {
      var i = 0
      fun read(idx: Int): Double = ops.getDouble(idx * 8)
      opLoop@ while (i < opCount) {
        val opcode = read(i++).toInt()
        when (opcode) {
          1 -> { // setProp
            if (i + 3 >= opCount) break@opLoop
            val nodeId = read(i++).toInt()
            val keyToken = read(i++).toInt()
            val valueType = read(i++).toInt()
            val payload = read(i++)
            if (keyToken < 0 && applyTypedSetProp(nodeId, -keyToken, valueType, payload, strings)) {
              continue@opLoop
            }
            val key = resolveTypedPropName(keyToken, strings)
            if (key.isEmpty()) continue@opLoop
            if (valueType == 1) {
              setProp(nodeId, key, payload)
            } else {
              val value: String? = when (valueType) {
                2 -> strings.getOrNull(payload.toInt())
                3 -> if (payload != 0.0) "true" else "false"
                else -> null
              }
              setProp(nodeId, key, value)
            }
          }
          2 -> { // setText
            if (i + 1 >= opCount) break@opLoop
            val nodeId = read(i++).toInt()
            val textIndex = read(i++).toInt()
            val text = strings.getOrNull(textIndex) ?: ""
            setText(nodeId, text)
          }
          3 -> { // insertChild
            if (i + 2 >= opCount) break@opLoop
            val parentId = read(i++).toInt()
            val childId = read(i++).toInt()
            val index = read(i++).toInt()
            insertChild(parentId, childId, index)
          }
          4 -> { // removeChild
            if (i + 1 >= opCount) break@opLoop
            val parentId = read(i++).toInt()
            val childId = read(i++).toInt()
            removeChild(parentId, childId)
          }
          5 -> { // dropNode
            if (i >= opCount) break@opLoop
            val nodeId = read(i++).toInt()
            dropNode(nodeId)
          }
          else -> break@opLoop
        }
      }
    } finally {
      endBatch()
    }
  }

  private fun beginBatch() {
    batchDepth += 1
  }

  private fun endBatch() {
    if (batchDepth == 0) return
    batchDepth -= 1
    if (batchDepth == 0 && batchNeedsLayout) {
      batchNeedsLayout = false
      // Always schedule through Choreographer to coalesce work and avoid long
      // synchronous layout bursts on the main thread at batch boundaries.
      requestLayout()
    }
  }

  internal fun isBatching(): Boolean = batchDepth > 0

  internal fun markBatchNeedsLayout() {
    batchNeedsLayout = true
  }

  fun beginAtomicCommit() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { beginAtomicCommit() }
      return
    }
    atomicCommitDepth += 1
  }

  fun endAtomicCommit() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { endAtomicCommit() }
      return
    }
    if (atomicCommitDepth == 0) return
    atomicCommitDepth -= 1
    if (atomicCommitDepth != 0) return
    if (dirtySurfaces.isEmpty()) {
      atomicCommitPending = false
      return
    }
    atomicCommitPending = true
    ensureChoreographer()
    needsLayout = true
    if (!frameCallbackPosted) {
      frameCallbackPosted = true
      choreographer?.postFrameCallback(frameCallback)
    }
  }

  fun registerSurface(surfaceId: Int, surfaceRoot: ViewGroup) {
    runOnMain { registerSurfaceInternal(surfaceId, surfaceRoot, owned = false) }
  }

  fun unregisterSurface(surfaceId: Int) {
    runOnMain { unregisterSurfaceInternal(surfaceId) }
  }

  fun setSurface(surfaceId: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { setSurface(surfaceId) }
      return
    }
    ensureSurface(surfaceId)
    activeSurfaceId = surfaceId
    markSurfaceDirty(surfaceId)
  }

  fun flush() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { flush() }
      return
    }
    markSurfaceDirty(activeSurfaceId)
    requestLayout()
  }

  private fun isSurfaceRootId(nodeId: Int): Boolean {
    return surfaceRoots.containsKey(nodeId)
  }

  internal fun tracePhase(name: String, durationNs: Long) {
    name
    durationNs
  }

  private fun traceOp(op: String, type: String?, startNs: Long) {
    op
    type
    startNs
  }

  private fun requestLayout() {
    requestLayoutInternal()
  }

  private fun ensureChoreographer() {
    ensureChoreographerInternal()
  }

  internal fun dpToPx(value: Float): Float = if (density == 0f) value else value * density

  internal fun pxToDp(value: Float): Double = if (density == 0f) value.toDouble() else (value / density).toDouble()

  internal fun usesAxonLayoutRuntime(): Boolean = runtimePtr != 0L

  internal fun setAxonStyleNumber(nodeId: Int, propId: Int, value: Float): Boolean {
    if (!usesAxonLayoutRuntime()) return false
    return JSBridge.axonSetStyleNumber(runtimePtr, nodeId, propId, value)
  }

  internal fun setAxonStyleString(nodeId: Int, propId: Int, value: String): Boolean {
    if (!usesAxonLayoutRuntime()) return false
    return JSBridge.axonSetStyleString(runtimePtr, nodeId, propId, value)
  }

  fun axonRegisterResolvedFont(family: String, weight: Int, italic: Boolean, sizePx: Float): Int {
    val key = AxonFontKey(family, weight, italic, sizePx.toBits())
    axonFontIds[key]?.let { return it }
    if (!usesAxonLayoutRuntime()) return Int.MAX_VALUE
    val fontId = JSBridge.axonRegisterResolvedFont(runtimePtr, family, weight, italic, sizePx)
    return rememberAxonResolvedFont(key, family, weight, italic, sizePx, fontId)
  }

  internal fun axonPrewarmResolvedFont(family: String, weight: Int, italic: Boolean, sizePx: Float): Int {
    val key = AxonFontKey(family, weight, italic, sizePx.toBits())
    axonFontIds[key]?.let { return it }
    if (!usesAxonLayoutRuntime()) return Int.MAX_VALUE
    val fontId = JSBridge.axonPrewarmResolvedFont(runtimePtr, family, weight, italic, sizePx)
    return rememberAxonResolvedFont(key, family, weight, italic, sizePx, fontId)
  }

  internal fun prewarmAxonTypography() {
    if (!usesAxonLayoutRuntime()) return
    val commonTuples = arrayOf(
      AxonFontKey("sans-serif", 400, false, dpToPx(16f).toBits()),
      AxonFontKey("sans-serif", 600, false, dpToPx(20f).toBits()),
      AxonFontKey("sans-serif", 400, false, dpToPx(12f).toBits()),
    )
    for (tuple in commonTuples) {
      axonPrewarmResolvedFont(
        tuple.family,
        tuple.weight,
        tuple.italic,
        Float.fromBits(tuple.sizePxBits),
      )
    }
  }

  internal fun isLayoutDirectionRtl(): Boolean {
    return rootView.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL
  }

  fun axonDensity(): Float = density

  fun axonMeasureText(fontId: Int, text: String, isVertical: Boolean): FloatArray? {
    val paint = axonFontPaints[fontId] ?: return null
    val width = if (text.isEmpty()) 0f else paint.measureText(text)
    val metrics = paint.fontMetrics
    val lineHeight = (metrics.bottom - metrics.top).coerceAtLeast(1f)
    return if (isVertical) {
      floatArrayOf(lineHeight, width)
    } else {
      floatArrayOf(width, lineHeight)
    }
  }

  fun axonMeasureNode(
    nodeId: Int,
    width: Float,
    widthMode: Int,
    height: Float,
    heightMode: Int,
  ): FloatArray? {
    val handler = measureHandlers[nodeId] ?: return null
    val measured = handler(
      MeasureInput(
        width = width,
        widthMode = when (widthMode) {
          1 -> MeasureMode.EXACTLY
          2 -> MeasureMode.AT_MOST
          else -> MeasureMode.UNDEFINED
        },
        height = height,
        heightMode = when (heightMode) {
          1 -> MeasureMode.EXACTLY
          2 -> MeasureMode.AT_MOST
          else -> MeasureMode.UNDEFINED
        },
      )
    )
    return floatArrayOf(measured.first, measured.second)
  }

  internal fun syncAxonTextMeasurement(nodeId: Int, textView: TextView) {
    if (!usesAxonLayoutRuntime()) return
    val textState = textStyleStates[nodeId]
    val family = textState?.fontFamily ?: "sans-serif"
    val weight = parseAxonFontWeight(textState?.fontWeight, textView.typeface)
    val italic = textState?.fontStyle == "italic" || (textState?.fontStyle == null && (textView.typeface?.isItalic == true))
    val sizePx = textState?.fontSizePx ?: textView.textSize
    val fontId = axonRegisterResolvedFont(family, weight, italic, sizePx)
    if (fontId == Int.MAX_VALUE) return
    val text = textView.text?.toString().orEmpty()
    JSBridge.axonSetTextMeasure(runtimePtr, nodeId, text, fontId)
  }

  private fun rememberAxonResolvedFont(
    key: AxonFontKey,
    family: String,
    weight: Int,
    italic: Boolean,
    sizePx: Float,
    fontId: Int,
  ): Int {
    if (fontId == Int.MAX_VALUE) return fontId
    val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply {
      textSize = sizePx
      typeface = createTypefaceForAxonFont(family, weight, italic)
    }
    axonFontIds[key] = fontId
    axonFontPaints[fontId] = paint
    return fontId
  }

  private fun applyResolvedTextTypeface(textView: TextView, textState: ZynthTextStyleState) {
    val family = textState.fontFamily
    val weight = parseAxonFontWeight(textState.fontWeight, textView.typeface)
    val italic = textState.fontStyle == "italic"
    val style = when {
      italic && weight >= 600 -> Typeface.BOLD_ITALIC
      italic -> Typeface.ITALIC
      weight >= 600 -> Typeface.BOLD
      else -> Typeface.NORMAL
    }
    textView.typeface = if (family.isNullOrEmpty()) {
      Typeface.create(Typeface.DEFAULT, style)
    } else {
      createTypefaceForAxonFont(family, weight, italic)
    }
  }

  private fun createTypefaceForAxonFont(family: String, weight: Int, italic: Boolean): Typeface {
    val style = when {
      italic && weight >= 600 -> Typeface.BOLD_ITALIC
      italic -> Typeface.ITALIC
      weight >= 600 -> Typeface.BOLD
      else -> Typeface.NORMAL
    }
    val custom = assetProvider?.getTypeface(family)
    return when {
      custom != null && family.contains("Icon") -> custom
      custom != null -> Typeface.create(custom, style)
      else -> Typeface.create(family, style)
    }
  }

  private fun parseAxonFontWeight(raw: String?, typeface: Typeface?): Int {
    return when (raw) {
      "100" -> 100
      "200" -> 200
      "300" -> 300
      "500" -> 500
      "600" -> 600
      "700", "bold", "800", "900" -> 700
      else -> if (typeface?.isBold == true) 700 else 400
    }
  }

  private fun scaleYogaValue(name: String, value: String?): String? {
    if (value.isNullOrBlank()) return value
    val trimmed = value.trim()
    if (trimmed == "auto" || trimmed.endsWith("%")) return value
    val numeric = trimmed.removeSuffix("px").toFloatOrNull() ?: return value
    val shouldScale = when (name) {
      "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
      "flexBasis", "top", "right", "bottom", "left",
      "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingRight",
      "paddingBottom", "paddingLeft", "margin", "marginHorizontal", "marginVertical",
      "marginTop", "marginRight", "marginBottom", "marginLeft", "gap", "rowGap",
      "columnGap" -> true
      else -> false
    }
    return if (shouldScale) dpToPx(numeric).toString() else value
  }

  private fun cacheYogaStyle(id: Int, name: String, value: Any?) {
    val styles = layoutStyleCache.getOrPut(id) { HashMap() }
    styles[name] = value
  }

  private fun moveSubtreeToSurface(nodeId: Int, surfaceId: Int, parentId: Int, index: Int) {
    nodes[nodeId] ?: return
    nodeSurfaces[nodeId] = surfaceId

    val childIds = children[nodeId]?.toList() ?: return
    for ((childIndex, childId) in childIds.withIndex()) {
      moveSubtreeToSurface(childId, surfaceId, nodeId, childIndex)
    }
  }

  fun getNodeView(nodeId: Int): View? {
    return nodes[nodeId]
  }

  fun applyAnimatedStyle(
    nodeId: Int,
    opacity: Float,
    translateX: Float,
    translateY: Float,
    scaleX: Float,
    scaleY: Float,
    rotate: Float,
    rotateX: Float,
    rotateY: Float,
    skewX: Float,
    skewY: Float,
    perspective: Float,
  ) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain {
        applyAnimatedStyleInternal(
          nodeId,
          opacity,
          translateX,
          translateY,
          scaleX,
          scaleY,
          rotate,
          rotateX,
          rotateY,
          skewX,
          skewY,
          perspective,
        )
      }
      return
    }
    applyAnimatedStyleInternal(
      nodeId,
      opacity,
      translateX,
      translateY,
      scaleX,
      scaleY,
      rotate,
      rotateX,
      rotateY,
      skewX,
      skewY,
      perspective,
    )
  }

  fun applyAnimatedLayoutStyle(
    nodeId: Int,
    width: Float,
    height: Float,
    minWidth: Float,
    minHeight: Float,
    maxWidth: Float,
    maxHeight: Float,
    flexBasis: Float,
  ) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain {
        applyAnimatedLayoutStyleInternal(
          nodeId,
          width,
          height,
          minWidth,
          minHeight,
          maxWidth,
          maxHeight,
          flexBasis,
        )
      }
      return
    }
    applyAnimatedLayoutStyleInternal(
      nodeId,
      width,
      height,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      flexBasis,
    )
  }

  private fun applyAnimatedLayoutStyleInternal(
    nodeId: Int,
    width: Float,
    height: Float,
    minWidth: Float,
    minHeight: Float,
    maxWidth: Float,
    maxHeight: Float,
    flexBasis: Float,
  ) {
    if (nodes[nodeId] == null) return
    var changed = false

    val applyDp = { name: String, value: Float ->
      if (value.isFinite()) {
        // Snap to physical pixels to avoid sub-pixel layout oscillation.
        val px = dpToPx(value).roundToInt().toFloat()
        val previous = layoutStyleCache[nodeId]?.get(name) as? Float
        if (previous != null && kotlin.math.abs(previous - px) < 0.5f) {
          Unit
        } else {
          cacheYogaStyle(nodeId, name, px)
          val propId = when (name) {
            "width" -> 1
            "height" -> 2
            "minWidth" -> 3
            "minHeight" -> 4
            "maxWidth" -> 5
            "maxHeight" -> 6
            "flexBasis" -> 10
            else -> 0
          }
          if (propId != 0) {
            setAxonStyleNumber(nodeId, propId, px)
          }
          changed = true
        }
      }
    }

    applyDp("width", width)
    applyDp("height", height)
    applyDp("minWidth", minWidth)
    applyDp("minHeight", minHeight)
    applyDp("maxWidth", maxWidth)
    applyDp("maxHeight", maxHeight)
    applyDp("flexBasis", flexBasis)

    if (changed) {
      markSurfaceDirtyForNode(nodeId)
    }
  }

  private fun applyAnimatedStyleInternal(
    nodeId: Int,
    opacity: Float,
    translateX: Float,
    translateY: Float,
    scaleX: Float,
    scaleY: Float,
    rotate: Float,
    rotateX: Float,
    rotateY: Float,
    skewX: Float,
    skewY: Float,
    perspective: Float,
  ) {
    val view = nodes[nodeId] ?: return
    view.alpha = opacity
    view.translationX = translateX * density
    view.translationY = translateY * density
    view.scaleX = scaleX
    view.scaleY = scaleY
    val has3dRotation = kotlin.math.abs(rotateX) > 0.001f || kotlin.math.abs(rotateY) > 0.001f
    if (has3dRotation) {
      val euler = computeEulerForRotateXY(rotateX, rotateY)
      view.rotationX = -euler.x
      view.rotationY = -euler.y
      view.rotation = if (rotate == 0f) euler.z else rotate
    } else {
      view.rotation = rotate
      view.rotationX = -rotateX
      view.rotationY = -rotateY
    }
    val viewDensity = view.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
    if (!perspective.isNaN() && perspective > 0f) {
      view.cameraDistance = perspective * viewDensity
    } else if (has3dRotation) {
      view.cameraDistance = DEFAULT_PERSPECTIVE * viewDensity
    }
    val hasSkew = kotlin.math.abs(skewX) > 0.001f || kotlin.math.abs(skewY) > 0.001f
    if (hasSkew) {
      val matrix = android.graphics.Matrix()
      val radX = Math.toRadians(skewX.toDouble()).toFloat()
      val radY = Math.toRadians(skewY.toDouble()).toFloat()
      val px = view.pivotX
      val py = view.pivotY
      matrix.setTranslate(-px, -py)
      val skewMatrix = android.graphics.Matrix()
      skewMatrix.setValues(
        floatArrayOf(
          1f,
          Math.tan(radX.toDouble()).toFloat(),
          0f,
          Math.tan(radY.toDouble()).toFloat(),
          1f,
          0f,
          0f,
          0f,
          1f,
        )
      )
      matrix.postConcat(skewMatrix)
      matrix.postTranslate(px, py)
      view.setLayerType(View.LAYER_TYPE_HARDWARE, null)
      view.setAnimationMatrix(matrix)
    } else {
      view.setAnimationMatrix(null)
      view.setLayerType(View.LAYER_TYPE_NONE, null)
    }
  }

  private data class EulerAngles(val x: Float, val y: Float, val z: Float)

  private fun computeEulerForRotateXY(rotateX: Float, rotateY: Float): EulerAngles {
    val rx = Math.toRadians(rotateX.toDouble())
    val ry = Math.toRadians(rotateY.toDouble())
    val rotateXMatrix = identityMatrix().apply { applyRotateX(this, rx) }
    val rotateYMatrix = identityMatrix().apply { applyRotateY(this, ry) }
    val combined = multiplyMatrices(rotateYMatrix, rotateXMatrix)
    return extractEulerFromMatrix(combined)
  }

  private fun identityMatrix(): DoubleArray {
    return doubleArrayOf(
      1.0, 0.0, 0.0, 0.0,
      0.0, 1.0, 0.0, 0.0,
      0.0, 0.0, 1.0, 0.0,
      0.0, 0.0, 0.0, 1.0,
    )
  }

  private fun applyRotateX(matrix: DoubleArray, radians: Double) {
    val cos = kotlin.math.cos(radians)
    val sin = kotlin.math.sin(radians)
    matrix[5] = cos
    matrix[6] = sin
    matrix[9] = -sin
    matrix[10] = cos
  }

  private fun applyRotateY(matrix: DoubleArray, radians: Double) {
    val cos = kotlin.math.cos(radians)
    val sin = kotlin.math.sin(radians)
    matrix[0] = cos
    matrix[2] = -sin
    matrix[8] = sin
    matrix[10] = cos
  }

  private fun multiplyMatrices(a: DoubleArray, b: DoubleArray): DoubleArray {
    val result = DoubleArray(16)
    var row = 0
    while (row < 4) {
      var col = 0
      while (col < 4) {
        result[row * 4 + col] =
          a[row * 4] * b[col] +
            a[row * 4 + 1] * b[col + 4] +
            a[row * 4 + 2] * b[col + 8] +
            a[row * 4 + 3] * b[col + 12]
        col += 1
      }
      row += 1
    }
    return result
  }

  private fun extractEulerFromMatrix(m: DoubleArray): EulerAngles {
    val sy = Math.sqrt(m[0] * m[0] + m[4] * m[4])
    val singular = sy < 1e-6
    val x: Double
    val y: Double
    val z: Double
    if (!singular) {
      x = Math.atan2(m[9], m[10])
      y = Math.atan2(-m[8], sy)
      z = Math.atan2(m[4], m[0])
    } else {
      x = Math.atan2(-m[6], m[5])
      y = Math.atan2(-m[8], sy)
      z = 0.0
    }
    return EulerAngles(
      Math.toDegrees(x).toFloat(),
      Math.toDegrees(y).toFloat(),
      Math.toDegrees(z).toFloat(),
    )
  }

  private fun maybeNotifyStyle(
    descriptor: com.zynth.kit.components.ZynthComponentDescriptor?,
    node: Node?,
    name: String,
    value: String?
  ) {
    if (descriptor == null || node == null || value == null) return
    if (!isStylePropForDescriptor(name)) return
    val style = styleFromProp(name, value) ?: return
    descriptor.onStyleApplied(node, style)
  }

  private fun isStylePropForDescriptor(name: String): Boolean {
    return when (name) {
      "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
      "flex", "flexGrow", "flexShrink", "flexBasis",
      "top", "right", "bottom", "left",
      "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingRight",
      "paddingBottom", "paddingLeft",
      "margin", "marginHorizontal", "marginVertical", "marginTop", "marginRight",
      "marginBottom", "marginLeft",
      "gap", "rowGap", "columnGap",
      "aspectRatio",
      "flexDirection", "direction", "justifyContent", "alignItems", "alignSelf", "alignContent",
      "flexWrap", "position", "display", "overflow",
      "background", "backgroundImage", "backgroundColor",
      "borderColor", "borderStyle", "borderRadius", "borderWidth",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
      "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius",
      "borderBottomLeftRadius",
      "color", "fontSize", "fontWeight", "fontFamily", "fontStyle",
      "textAlign", "lineHeight", "lineSpacing", "paragraphSpacing", "letterSpacing",
      "textDecorationLine", "textTransform", "minimumFontScale", "baselineShift",
      "hyphenation",
      "opacity", "elevation", "zIndex",
      "transform", "transformOrigin",
      "shadowColor", "shadowOpacity", "shadowRadius", "shadowOffset", "boxShadow" -> true
      else -> false
    }
  }

  private fun descriptorFor(node: Node?): ZynthComponentDescriptor? {
    if (node == null) return null
    if (descriptorCacheNodeId == node.id && descriptorCacheType == node.type) {
      return descriptorCacheValue
    }
    val descriptor = ZynthComponentRegistry.getDescriptor(node.type)
    descriptorCacheNodeId = node.id
    descriptorCacheType = node.type
    descriptorCacheValue = descriptor
    return descriptor
  }

  private fun applyTypedSetProp(
    nodeId: Int,
    propId: Int,
    valueType: Int,
    payload: Double,
    strings: Array<String?>
  ): Boolean {
    if (valueType == 1) {
      when (propId) {
        1 -> { setProp(nodeId, "width", payload); return true }
        2 -> { setProp(nodeId, "height", payload); return true }
        3 -> { setProp(nodeId, "minWidth", payload); return true }
        4 -> { setProp(nodeId, "minHeight", payload); return true }
        5 -> { setProp(nodeId, "maxWidth", payload); return true }
        6 -> { setProp(nodeId, "maxHeight", payload); return true }
        7 -> { setProp(nodeId, "flex", payload); return true }
        8 -> { setProp(nodeId, "flexGrow", payload); return true }
        9 -> { setProp(nodeId, "flexShrink", payload); return true }
        10 -> { setProp(nodeId, "flexBasis", payload); return true }
        11 -> { setProp(nodeId, "top", payload); return true }
        12 -> { setProp(nodeId, "right", payload); return true }
        13 -> { setProp(nodeId, "bottom", payload); return true }
        14 -> { setProp(nodeId, "left", payload); return true }
        15 -> { setProp(nodeId, "padding", payload); return true }
        16 -> { setProp(nodeId, "paddingHorizontal", payload); return true }
        17 -> { setProp(nodeId, "paddingVertical", payload); return true }
        18 -> { setProp(nodeId, "paddingTop", payload); return true }
        19 -> { setProp(nodeId, "paddingRight", payload); return true }
        20 -> { setProp(nodeId, "paddingBottom", payload); return true }
        21 -> { setProp(nodeId, "paddingLeft", payload); return true }
        22 -> { setProp(nodeId, "margin", payload); return true }
        23 -> { setProp(nodeId, "marginHorizontal", payload); return true }
        24 -> { setProp(nodeId, "marginVertical", payload); return true }
        25 -> { setProp(nodeId, "marginTop", payload); return true }
        26 -> { setProp(nodeId, "marginRight", payload); return true }
        27 -> { setProp(nodeId, "marginBottom", payload); return true }
        28 -> { setProp(nodeId, "marginLeft", payload); return true }
        29 -> { setProp(nodeId, "gap", payload); return true }
        30 -> { setProp(nodeId, "rowGap", payload); return true }
        31 -> { setProp(nodeId, "columnGap", payload); return true }
        32 -> { setProp(nodeId, "aspectRatio", payload); return true }
        58 -> { setProp(nodeId, "fontSize", payload); return true }
        63 -> { setProp(nodeId, "opacity", payload); return true }
        64 -> { setProp(nodeId, "elevation", payload); return true }
        65 -> { setProp(nodeId, "zIndex", payload); return true }
        68 -> { setProp(nodeId, "shadowColor", payload); return true }
        69 -> { setProp(nodeId, "shadowOpacity", payload); return true }
        70 -> { setProp(nodeId, "shadowRadius", payload); return true }
        73 -> { setProp(nodeId, "lineHeight", payload); return true }
        74 -> { setProp(nodeId, "lineSpacing", payload); return true }
        75 -> { setProp(nodeId, "paragraphSpacing", payload); return true }
        76 -> { setProp(nodeId, "letterSpacing", payload); return true }
        79 -> { setProp(nodeId, "minimumFontScale", payload); return true }
        80 -> { setProp(nodeId, "baselineShift", payload); return true }
      }
      return false
    }
    if (valueType == 3) {
      val value = if (payload != 0.0) "true" else "false"
      when (propId) {
        90 -> { setProp(nodeId, "enableDoublePress", value); return true }
        91 -> { setProp(nodeId, "multiline", value); return true }
        94 -> { setProp(nodeId, "editable", value); return true }
        95 -> { setProp(nodeId, "secureTextEntry", value); return true }
        98 -> { setProp(nodeId, "autoCorrect", value); return true }
        99 -> { setProp(nodeId, "spellCheck", value); return true }
        101 -> { setProp(nodeId, "blurOnSubmit", value); return true }
      }
      return false
    }
    if (valueType == 2) {
      val value = strings.getOrNull(payload.toInt()) ?: return false
      when (propId) {
        33 -> { setProp(nodeId, "flexDirection", value); return true }
        34 -> { setProp(nodeId, "justifyContent", value); return true }
        35 -> { setProp(nodeId, "alignItems", value); return true }
        36 -> { setProp(nodeId, "alignSelf", value); return true }
        37 -> { setProp(nodeId, "alignContent", value); return true }
        38 -> { setProp(nodeId, "flexWrap", value); return true }
        39 -> { setProp(nodeId, "position", value); return true }
        40 -> { setProp(nodeId, "display", value); return true }
        41 -> { setProp(nodeId, "overflow", value); return true }
        42 -> { setProp(nodeId, "background", value); return true }
        43 -> { setProp(nodeId, "backgroundImage", value); return true }
        44 -> { setProp(nodeId, "backgroundColor", value); return true }
        45 -> { setProp(nodeId, "borderColor", value); return true }
        46 -> { setProp(nodeId, "borderStyle", value); return true }
        47 -> { setProp(nodeId, "borderRadius", value); return true }
        57 -> { setProp(nodeId, "color", value); return true }
        59 -> { setProp(nodeId, "fontWeight", value); return true }
        60 -> { setProp(nodeId, "fontFamily", value); return true }
        61 -> { setProp(nodeId, "fontStyle", value); return true }
        62 -> { setProp(nodeId, "textAlign", value); return true }
        66 -> { setProp(nodeId, "transform", value); return true }
        67 -> { setProp(nodeId, "transformOrigin", value); return true }
        71 -> { setProp(nodeId, "shadowOffset", value); return true }
        72 -> { setProp(nodeId, "boxShadow", value); return true }
        77 -> { setProp(nodeId, "textDecorationLine", value); return true }
        78 -> { setProp(nodeId, "textTransform", value); return true }
        81 -> { setProp(nodeId, "hyphenation", value); return true }
        82 -> { setProp(nodeId, "pointerEvents", value); return true }
        83 -> { setProp(nodeId, "accessibilityLabel", value); return true }
        84 -> { setProp(nodeId, "accessibilityHint", value); return true }
        85 -> { setProp(nodeId, "accessibilityRole", value); return true }
        86 -> { setProp(nodeId, "testID", value); return true }
        87 -> { setProp(nodeId, "layout", value); return true }
        96 -> { setProp(nodeId, "inputMode", value); return true }
        97 -> { setProp(nodeId, "autoCapitalize", value); return true }
        100 -> { setProp(nodeId, "returnKeyType", value); return true }
        102 -> { setProp(nodeId, "submitBehavior", value); return true }
        105 -> { setProp(nodeId, "value", value); return true }
        106 -> { setProp(nodeId, "defaultValue", value); return true }
        107 -> { setProp(nodeId, "placeholder", value); return true }
        108 -> { setProp(nodeId, "selection", value); return true }
        109 -> { setProp(nodeId, "selectionColor", value); return true }
        110 -> { setProp(nodeId, "caretColor", value); return true }
        111 -> { setProp(nodeId, "clearButtonMode", value); return true }
        112 -> { setProp(nodeId, "showClearAccessory", value); return true }
        113 -> { setProp(nodeId, "__scrollCommand", value); return true }
        114 -> { setProp(nodeId, "direction", value); return true }
      }
    }
    return false
  }

  private fun styleFromProp(name: String, rawValue: String): Style? {
    val trimmed = rawValue.trim()
    val jsonValue = when {
      rawValue.isEmpty() -> JSONObject.quote("")
      trimmed == "true" || trimmed == "false" -> trimmed
      trimmed.toDoubleOrNull() != null -> trimmed
      trimmed.startsWith("{") || trimmed.startsWith("[") -> trimmed
      else -> JSONObject.quote(rawValue)
    }
    val json = "{\"$name\":$jsonValue}"
    return runCatching { Style.fromJson(json) }.getOrNull()
  }
}
