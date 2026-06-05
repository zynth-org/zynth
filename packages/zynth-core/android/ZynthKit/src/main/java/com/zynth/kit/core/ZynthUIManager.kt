package com.zynth.kit.core

import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import java.nio.ByteBuffer
import java.nio.ByteOrder
import android.view.Choreographer
import android.view.Gravity
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import android.view.ViewPropertyAnimator
import android.widget.TextView
import android.util.Log
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.layout.LayoutEngine
import com.zynth.kit.layout.MeasureHandler
import com.zynth.kit.layout.Rect as LayoutRect
import com.zynth.kit.layout.Style
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.runtime.JSBridge
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.abs
import kotlin.math.roundToInt

// TODO: Move this to a separate file or optimize
private const val TRACE_TAG = "ZynthUIManager"
private const val STARTUP_TRACE_TAG = "ZynthStartup"
private const val DEFAULT_PERSPECTIVE = 500f
private const val DEBUG_TEXT = false
private const val DEBUG_TEXT_DIRTY = false

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
    114 -> "borderTopColor"
    115 -> "borderRightColor"
    116 -> "borderBottomColor"
    117 -> "borderLeftColor"
    else -> ""
  }
}

private fun typedPropName(propId: Int): String {
  return resolveTypedPropName(-propId, emptyArray<String?>())
}

private const val TYPESAFE_UNKNOWN = "unknown"

class ZynthUIManager(internal val rootView: ZynthRootView) : ZynthEventSink {
  internal var runtimePtr: Long = 0L
  internal val mainHandler = Handler(Looper.getMainLooper())
  internal val density = rootView.resources.displayMetrics.density
  internal var nextId = 1
  internal val nodes = ConcurrentHashMap<Int, View>()
  internal val nodeStates = ConcurrentHashMap<Int, Node>()
  internal val parents = ConcurrentHashMap<Int, Int>()
  internal val children = ConcurrentHashMap<Int, CopyOnWriteArrayList<Int>>()
  internal val nodeSurfaces = ConcurrentHashMap<Int, Int>()
  internal val surfaceRoots = ConcurrentHashMap<Int, ViewGroup>()
  internal val dirtySurfaces = ConcurrentHashMap.newKeySet<Int>()
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
  private val keyboardAvoidingBasePaddingBottoms = HashMap<Int, Int>()
  private val keyboardAvoidingBaseHeights = HashMap<Int, Int>()
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
  internal val layoutPendingNodes = ConcurrentHashMap.newKeySet<Int>()
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
  internal val layoutEngine: LayoutEngine by lazy { this.LayoutEngineAdapter() }
  private data class TimerEntry(
    val handler: Handler,
    val runnable: Runnable,
  )
  private val timerEntries = HashMap<Int, TimerEntry>()
  private val animationFrameCallbacks = HashMap<Int, Choreographer.FrameCallback>()
  private data class TypefaceCacheKey(
    val family: String,
    val style: Int,
    val custom: Boolean,
  )
  private var descriptorCacheNodeId: Int = Int.MIN_VALUE
  private var descriptorCacheType: String? = null
  private var descriptorCacheValue: ZynthComponentDescriptor? = null
  private val typefaceCache = ConcurrentHashMap<TypefaceCacheKey, Typeface>()
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
  internal val layoutDebugCounts = LinkedHashMap<String, Int>()
  internal var layoutDebugLastLogMs = android.os.SystemClock.uptimeMillis()
  private var batchDepth = 0
  private var batchNeedsLayout = false
  private var atomicCommitDepth = 0
  internal var nativeCommitEnabled = true
  internal var atomicCommitPending = false
  internal val budgetMetrics = com.zynth.kit.runtime.ZynthBudgetMetrics()
  var assetProvider: AssetProvider? = null
  private val startupTelemetryEnabled: Boolean by lazy {
    val raw = System.getProperty("ZYNTH_STARTUP_METRICS")?.trim() ?: return@lazy false
    raw == "1" || raw.equals("true", ignoreCase = true) || raw.equals("yes", ignoreCase = true) || raw.equals("on", ignoreCase = true)
  }
  private var didLogFirstSyncMountBreakdown = false

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

  fun cancelSharedSignalAnimation(id: Int): Boolean {
    if (runtimePtr == 0L) return false
    return JSBridge.cancelSharedSignalAnimation(runtimePtr, id)
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
    val textChildren: MutableList<Int> = CopyOnWriteArrayList(),
    var cachedText: String = "",
    var pointerEvents: String = "auto",
    val attachments: MutableMap<String, Any?> = ConcurrentHashMap(),
    var mountHasVisualProps: Boolean = false,
    var mountAwaitingFirstProps: Boolean = false,
    var layoutTransition: LayoutTransitionConfig? = null,
    var layoutAnimator: ViewPropertyAnimator? = null,
    var measureHandler: com.zynth.kit.layout.MeasureHandler? = null,
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
    runtimePtr = ptr
  }

  fun setFrameProfiler(profiler: ((frameMs: Double, layoutMs: Double, overBudget: Boolean, nodeCount: Int) -> Unit)?) {
    setFrameProfilerInternal(profiler)
  }

  fun createNode(type: String): Int {
    val id = nextId++
    createNode(type, id)
    return id
  }

  fun createNode(type: String, id: Int) {
    val create = {
      val startNs = System.nanoTime()
      if (droppedBeforeCreation.remove(id)) {
        // This node was dropped before it could be created. Skip.
        traceOp("createNodeSkip", type, startNs)
      } else if (!nodes.containsKey(id)) {
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
        pointerEvents[id] = "auto"
        nodeSurfaces[id] = activeSurfaceId
        // Tell C++ to use measure function if needed
        descriptor?.onNodeCreated?.invoke(this, node)
        
        // Finalize by adding to maps so JS thread can see it
        nodeStates[id] = node
        traceOp("createNode", type, startNs)
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      create()
    } else {
      runOnMain { create() }
    }
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
      maybeNotifyStyle(descriptor, node, name, value.toString())
      traceOp("setProp", node?.type, startNs)
      return
    }

    if (node != null && descriptor?.applyProperty?.invoke(node, name, value.toString()) == true) {
      maybeNotifyStyle(descriptor, node, name, value.toString())
      traceOp("setProp", node.type, startNs)
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
          // Only capture if already laid out, otherwise we'll animate from (0,0,0,0)
          if (view.width > 0 || view.height > 0) {
            layoutTransitionFrames[id] = android.graphics.Rect(view.left, view.top, view.right, view.bottom)
          }
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
      view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, dpToPx(size))
      markSurfaceDirtyForNode(id, "textStyle:fontSize:fallback")
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontWeight") {
      val weight = value ?: return
      val style = if (weight == "bold" || weight == "700" || weight == "600") {
        Typeface.BOLD
      } else {
        Typeface.NORMAL
      }
      view.setTypeface(view.typeface, style)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontStyle") {
      val style = if (value == "italic") Typeface.ITALIC else Typeface.NORMAL
      view.setTypeface(view.typeface, style)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontFamily") {
      if (value == null) {
        view.typeface = Typeface.DEFAULT
        view.includeFontPadding = true
        view.gravity = Gravity.START
        markSurfaceDirtyForNode(id, "textStyle:fontFamily:default")
        maybeNotifyStyle(descriptor, node, name, value)
        traceOp("setProp", node?.type, startNs)
        return
      }
      val family = value
      val custom = assetProvider?.getTypeface(family)
      val style = view.typeface?.style ?: Typeface.NORMAL
      if (custom != null) {
        // If it's an icon font, we MUST use the typeface directly.
        // Typeface.create(custom, style) can fail to preserve the glyphs if the style (e.g. Bold) isn't supported by the font file.
        if (family.contains("Icon")) {
          view.typeface = custom
          view.includeFontPadding = false
          view.gravity = Gravity.CENTER
        } else {
          view.typeface = Typeface.create(custom, style)
          view.includeFontPadding = true
        }
      } else {
        view.typeface = Typeface.create(family, style)
        view.includeFontPadding = true
      }
      markSurfaceDirtyForNode(id, "textStyle:fontFamily")
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
    maybeNotifyStyle(descriptor, node, name, value)
    traceOp("setProp", node?.type, startNs)
  }

  private fun applyTypedTextNumberProp(nodeId: Int, propId: Int, payload: Double): Boolean {
    val view = nodes[nodeId] as? TextView ?: return false
    val node = nodeStates[nodeId]
    val descriptor = descriptorFor(node)
    when (propId) {
      58 -> {
        val size = payload.toFloat()
        view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, dpToPx(size))
        markSurfaceDirtyForNode(nodeId, "textStyle:fontSize:typed")
        if (descriptor != null && node != null) {
          maybeNotifyStyle(descriptor, node, "fontSize", payload.toString())
        }
        return true
      }
      else -> return false
    }
  }

  private fun applyCachedFontFamily(view: TextView, family: String): Boolean {
    val style = view.typeface?.style ?: Typeface.NORMAL
    val custom = assetProvider?.getTypeface(family)
    if (custom != null) {
      val key = TypefaceCacheKey(family, style, true)
      val resolved = typefaceCache.getOrPut(key) {
        if (family.contains("Icon")) custom else Typeface.create(custom, style)
      }
      view.typeface = resolved
      view.includeFontPadding = !family.contains("Icon")
      if (family.contains("Icon")) {
        view.gravity = Gravity.CENTER
      }
      return true
    }
    val key = TypefaceCacheKey(family, style, false)
    view.typeface = typefaceCache.getOrPut(key) { Typeface.create(family, style) }
    view.includeFontPadding = true
    return true
  }

  private fun applyTypedTextStringProp(nodeId: Int, propId: Int, value: String): Boolean {
    val view = nodes[nodeId] as? TextView ?: return false
    val node = nodeStates[nodeId]
    val descriptor = descriptorFor(node)
    when (propId) {
      57 -> {
        ZynthColorParser.parse(value)?.let(view::setTextColor)
      }
      59 -> {
        val style = if (value == "bold" || value == "700" || value == "600") {
          Typeface.BOLD
        } else {
          Typeface.NORMAL
        }
        view.setTypeface(view.typeface, style)
      }
      60 -> {
        applyCachedFontFamily(view, value)
        markSurfaceDirtyForNode(nodeId, "textStyle:fontFamily:typed")
      }
      61 -> {
        val style = if (value == "italic") Typeface.ITALIC else Typeface.NORMAL
        view.setTypeface(view.typeface, style)
      }
      62 -> {
        view.gravity = when (value) {
          "center" -> Gravity.CENTER_HORIZONTAL
          "right" -> Gravity.END
          "left" -> Gravity.START
          else -> Gravity.START
        }
      }
      else -> return false
    }
    if (descriptor != null && node != null) {
      maybeNotifyStyle(descriptor, node, typedPropName(propId), value)
    }
    return true
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
    val surfaceId = nodeSurfaces[nodeId] ?: activeSurfaceId
    if (surfaceId >= 1048576) {
      layoutTransitionFrames.remove(nodeId)
      val node = nodeStates[nodeId] ?: return
      val view = node.view
      node.layoutAnimator?.cancel()
      node.layoutAnimator = null
      view.translationX = 0f
      view.translationY = 0f
      view.scaleX = 1f
      view.scaleY = 1f
      return
    }
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
      .withEndAction {
        node.layoutAnimator = null
      }

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
    
    val node = nodeStates[id]
    val descriptor = descriptorFor(node)
    val handledByDescriptor =
      if (node != null) descriptor?.applyProperty?.invoke(node, "text", text) == true else false
    if (!handledByDescriptor && view is TextView) {
      val oldText = node?.label?.text?.toString() ?: ""
      node?.label?.text = text
      applyTextValue(id, view, text)
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
      if (DEBUG_TEXT) {
        Log.d(TRACE_TAG, "insert-detach-previous id=$childId from=$previousParentId nextParent=$parentId")
      }
      children[previousParentId]?.remove(childId as Any?)
      nodeStates[previousParentId]?.textChildren?.removeAll { it == childId }
    }
    (child.parent as? ViewGroup)?.removeView(child)
    parents[childId] = parentId
    val siblings = children.getOrPut(parentId) { CopyOnWriteArrayList() }
    val existingIndex = siblings.indexOf(childId)
    if (existingIndex >= 0) {
      siblings.removeAt(existingIndex)
    }
    val insertIndex = index.coerceIn(0, siblings.size)
    siblings.add(insertIndex, childId)
    parentTextChildren?.add(insertIndex.coerceIn(0, parentTextChildren.size), childId)
    val previousSurfaceId = nodeSurfaces[childId]
    if (previousSurfaceId != surfaceId) {
      nodeSurfaces[childId] = surfaceId
      // In native commit mode, C++ handles subtree surface migration.
    } else {
      nodeSurfaces[childId] = surfaceId
    }
    val descriptor = parentState?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (descriptor != null && nodeStates[childId] != null) {
      descriptor.onChildInserted(this, parentState!!, nodeStates[childId]!!, index)
    }

    if (parent is TextView && child is TextView) {
      // Text composition is handled by the descriptor via updateComposedText
      traceOp("insertChild", parentState?.type, startNs)
      return
    }
    val group = parent as? ViewGroup
    if (group == null) {
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
    markSurfaceDirtyForNode(childId, "removeChild")
    traceOp("removeChild", parentState?.type, startNs)
  }

  fun dropNode(nodeId: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { dropNode(nodeId) }
      return
    }
    val startNs = System.nanoTime()
    val type = nodeStates[nodeId]?.type
    val parentId = parents[nodeId] ?: -1
    if ((nodeSurfaces[nodeId] ?: activeSurfaceId) >= 1048576 || type == "text") {
    }
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
      val isNewLayoutNode = layoutNodes.add(id)
      if (isNewLayoutNode) {
        layoutPendingNodes.add(id)
        requestLayout("setHandler:onLayout")
      }
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

  fun getLayoutEngine(): LayoutEngine = layoutEngine

  fun getRootView(): ZynthRootView = rootView

  fun snapshot(options: JSONObject? = null): JSONObject {
    return buildScreenSnapshot(options)
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
    layoutEngine.setMeasureHandler(nodeId, handler)
    if (handler != null) {
      layoutEngine.markDirty(nodeId)
    }
  }

  /**
   * Mark a node as dirty so its intrinsic size can be remeasured.
   * Used by components when text or content changes.
   */
  fun markNodeDirty(nodeId: Int, reason: String = "unknown") {
    layoutEngine.markDirty(nodeId)
    if (runtimePtr != 0L) {
      com.zynth.kit.runtime.JSBridge.markMeasuredNodeDirty(runtimePtr, nodeId)
    }
    requestLayout("markNodeDirty:$reason")
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
    val view = nodes[nodeId] ?: return
    val overlap = overlapPx.coerceAtLeast(0f)

    when (behavior) {
      "padding" -> {
        val basePadding = keyboardAvoidingBasePaddingBottoms.getOrPut(nodeId) {
          view.paddingBottom
        }
        val nextPadding = if (overlap <= 0f) {
          keyboardAvoidingBasePaddingBottoms.remove(nodeId) ?: basePadding
        } else {
          basePadding + overlap.roundToInt()
        }
        view.setPadding(
          view.paddingLeft,
          view.paddingTop,
          view.paddingRight,
          nextPadding,
        )
      }
      "height" -> {
        val baseHeight = availableHeightPx?.roundToInt()
          ?: keyboardAvoidingBaseHeights.getOrPut(nodeId) { view.height }
        val nextHeight = if (overlap <= 0f) {
          keyboardAvoidingBaseHeights.remove(nodeId) ?: baseHeight
        } else {
          (baseHeight - overlap).coerceAtLeast(0f).roundToInt()
        }
        val params = view.layoutParams
        if (params != null && params.height != nextHeight) {
          params.height = nextHeight
          view.layoutParams = params
        }
      }
    }
    view.requestLayout()
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
      fun read(idx: Int): Double = ops[idx]
      opLoop@ while (i < ops.size) {
        val opcode = read(i++).toInt()
        when (opcode) {
          1 -> { // setProp
            if (i + 3 >= ops.size) break@opLoop
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
                4 -> "${payload}%"
                5 -> "auto"
                else -> null
              }
              setProp(nodeId, key, value)
            }
          }
          2 -> { // setText
            if (i + 1 >= ops.size) break@opLoop
            val nodeId = read(i++).toInt()
            val textIndex = read(i++).toInt()
            val text = strings.getOrNull(textIndex) ?: ""
            setText(nodeId, text)
          }
          3 -> { // insertChild
            if (i + 2 >= ops.size) break@opLoop
            val parentId = read(i++).toInt()
            val childId = read(i++).toInt()
            val index = read(i++).toInt()
            insertChild(parentId, childId, index)
          }
          4 -> { // removeChild
            if (i + 1 >= ops.size) break@opLoop
            val parentId = read(i++).toInt()
            val childId = read(i++).toInt()
            removeChild(parentId, childId)
          }
          5 -> { // dropNode
            if (i >= ops.size) break@opLoop
            val nodeId = read(i++).toInt()
            dropNode(nodeId)
          }
          6 -> { // createNode (nodeId, typeStringIndex, hasMeasure)
            if (i + 2 >= ops.size) break@opLoop
            val nodeId = read(i++).toInt()
            val typeIndex = read(i++).toInt()
            val hasMeasure = read(i++) != 0.0
            val type = strings.getOrNull(typeIndex) ?: "view"
            createNode(type, nodeId)
          }
          7 -> { // setSurface (surfaceId)
            if (i >= ops.size) break@opLoop
            val surfaceId = read(i++).toInt()
            setSurface(surfaceId)
          }
          else -> break@opLoop
        }
      }
    } finally {
      endBatch("applyBatchTypedPacked")
    }
  }

  @androidx.annotation.Keep
  fun measureNode(id: Int, width: Float, widthMode: Int, height: Float, heightMode: Int): Long {
    try {
      val node = nodeStates[id] ?: return 0L
      val view = node.view
      
      val handler = node.measureHandler ?: layoutEngine.getMeasureHandler(id)
      
      if (handler != null) {
        // Cache it back if we found it via JNI fallback
        if (node.measureHandler == null) {
          node.measureHandler = handler
        }
        val input = com.zynth.kit.layout.MeasureInput(
          width = width,
          widthMode = when (widthMode) {
            1 -> com.zynth.kit.layout.MeasureMode.EXACTLY
            2 -> com.zynth.kit.layout.MeasureMode.AT_MOST
            else -> com.zynth.kit.layout.MeasureMode.UNDEFINED
          },
          height = height,
          heightMode = when (heightMode) {
            1 -> com.zynth.kit.layout.MeasureMode.EXACTLY
            2 -> com.zynth.kit.layout.MeasureMode.AT_MOST
            else -> com.zynth.kit.layout.MeasureMode.UNDEFINED
          }
        )
        val result = handler(input)
        val mw = result.first
        val mh = result.second
        
        val modeStrW = when(widthMode) { 1 -> "EXACTLY"; 2 -> "AT_MOST"; else -> "UNDEFINED" }
        val modeStrH = when(heightMode) { 1 -> "EXACTLY"; 2 -> "AT_MOST"; else -> "UNDEFINED" }


        val mwBits = mw.toRawBits().toLong()
        val mhBits = mh.toRawBits().toLong()
        return (mwBits shl 32) or (mhBits and 0xFFFFFFFFL)
      }

      val widthSpec = when (widthMode) {
        0 -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        1 -> View.MeasureSpec.makeMeasureSpec(width.toInt().coerceAtLeast(0), View.MeasureSpec.EXACTLY)
        2 -> View.MeasureSpec.makeMeasureSpec(width.toInt().coerceAtLeast(0), View.MeasureSpec.AT_MOST)
        else -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
      }
      
      val heightSpec = when (heightMode) {
        0 -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        1 -> View.MeasureSpec.makeMeasureSpec(height.toInt().coerceAtLeast(0), View.MeasureSpec.EXACTLY)
        2 -> View.MeasureSpec.makeMeasureSpec(height.toInt().coerceAtLeast(0), View.MeasureSpec.AT_MOST)
        else -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
      }

      if (view is TextView) {
        // Fallback for TextViews that don't have a component descriptor handler.
        // We must avoid touching the view from the JS thread.
        // Instead of measuring the live view, we return a reasonable default or 
        // rely on the descriptor to provide a thread-safe measure function.
        val mw = view.measuredWidth.toFloat().coerceAtLeast(0f)
        val mh = view.measuredHeight.toFloat().coerceAtLeast(0f)
        
        val mwBits = mw.toRawBits().toLong()
        val mhBits = mh.toRawBits().toLong()
        return (mwBits shl 32) or (mhBits and 0xFFFFFFFFL)
      }
      
      view.measure(widthSpec, heightSpec)
      val mw = view.measuredWidth.toFloat()
      val mh = view.measuredHeight.toFloat()
      val mwBits = mw.toRawBits().toLong()
      val mhBits = mh.toRawBits().toLong()
      return (mwBits shl 32) or (mhBits and 0xFFFFFFFFL)
    } catch (e: Throwable) {
      Log.e("ZynthUIManager", "Error measuring node $id: ${e.message}", e)
      return 0L
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
                4 -> "${payload}%"
                5 -> "auto"
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
          6 -> { // createNode (nodeId, typeStringIndex)
            if (i + 1 >= opCount) break@opLoop
            val nodeId = read(i++).toInt()
            val typeIndex = read(i++).toInt()
            val type = strings.getOrNull(typeIndex) ?: "view"
            createNode(type, nodeId)
          }
          7 -> { // setSurface (surfaceId)
            if (i >= opCount) break@opLoop
            val surfaceId = read(i++).toInt()
            setSurface(surfaceId)
          }
          else -> break@opLoop
        }
      }
    } finally {
      endBatch("applyBatchTypedBuffer")
    }
  }

  @androidx.annotation.Keep
  fun applyMountTransactionSync(buffer: ByteBuffer, opCount: Int, strings: Array<String?>) {
    val ops = buffer.order(ByteOrder.nativeOrder())
    if (Looper.myLooper() != Looper.getMainLooper()) {
      val byteLength = opCount * 8
      val source = ops.duplicate().order(ByteOrder.nativeOrder())
      source.position(0)
      source.limit(byteLength.coerceAtMost(source.capacity()))
      val copied = acquireByteBuffer(byteLength)
      copied.put(source)
      copied.rewind()
      // Copy strings to prevent JNI reference corruption on background threads
      val copiedStrings = strings.clone()
      val latch = java.util.concurrent.CountDownLatch(1)
      runOnMain { 
        applyMountTransactionInternal(copied, opCount, copiedStrings, source = "sync")
        releaseByteBuffer(copied)
        latch.countDown()
      }
      latch.await()
      return
    }
    applyMountTransactionInternal(buffer, opCount, strings, source = "sync")
  }

  @androidx.annotation.Keep
  fun applyMountTransaction(buffer: ByteBuffer, opCount: Int, strings: Array<String?>) {
    val ops = buffer.order(ByteOrder.nativeOrder())
    if (Looper.myLooper() != Looper.getMainLooper()) {
      val byteLength = opCount * 8
      val source = ops.duplicate().order(ByteOrder.nativeOrder())
      source.position(0)
      source.limit(byteLength.coerceAtMost(source.capacity()))
      val copied = acquireByteBuffer(byteLength)
      copied.put(source)
      copied.rewind()
      // Copy strings to prevent JNI reference corruption on background threads
      val copiedStrings = strings.clone()
      runOnMain { 
        applyMountTransactionInternal(copied, opCount, copiedStrings, source = "async")
        releaseByteBuffer(copied)
      }
      return
    }
    applyMountTransactionInternal(buffer, opCount, strings, source = "async")
  }

  private fun applyMountTransactionInternal(ops: ByteBuffer, opCount: Int, strings: Array<String?>, source: String) {
    val logStartupBreakdown = startupTelemetryEnabled && source == "sync" && !didLogFirstSyncMountBreakdown
    val transactionStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
    var setPropNs = 0L
    var setTextNs = 0L
    var insertChildNs = 0L
    var removeChildNs = 0L
    var dropNodeNs = 0L
    var createNodeNs = 0L
    var setSurfaceNs = 0L
    var frameNs = 0L
    var frameMeasureNs = 0L
    var frameLayoutNs = 0L
    var setPropCount = 0
    var setTextCount = 0
    var insertChildCount = 0
    var removeChildCount = 0
    var dropNodeCount = 0
    var createNodeCount = 0
    var setSurfaceCount = 0
    var frameCount = 0
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
            val opStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
            val nodeId = read(i++).toInt()
            val keyToken = read(i++).toInt()
            val valueType = read(i++).toInt()
            val payload = read(i++)
            if (keyToken < 0 && applyTypedSetProp(nodeId, -keyToken, valueType, payload, strings)) {
              if (logStartupBreakdown) {
                setPropNs += System.nanoTime() - opStartNs
                setPropCount += 1
              }
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
                4 -> "${payload}%"
                5 -> "auto"
                else -> null
              }
              setProp(nodeId, key, value)
            }
            if (logStartupBreakdown) {
              setPropNs += System.nanoTime() - opStartNs
              setPropCount += 1
            }
          }
          2 -> { // setText
            if (i + 1 >= opCount) break@opLoop
            val opStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
            val nodeId = read(i++).toInt()
            val textIndex = read(i++).toInt()
            val text = strings.getOrNull(textIndex) ?: ""
            setText(nodeId, text)
            if (logStartupBreakdown) {
              setTextNs += System.nanoTime() - opStartNs
              setTextCount += 1
            }
          }
          3 -> { // insertChild
            if (i + 2 >= opCount) break@opLoop
            val opStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
            val parentId = read(i++).toInt()
            val childId = read(i++).toInt()
            val index = read(i++).toInt()
            insertChild(parentId, childId, index)
            if (logStartupBreakdown) {
              insertChildNs += System.nanoTime() - opStartNs
              insertChildCount += 1
            }
          }
          4 -> { // removeChild
            if (i + 1 >= opCount) break@opLoop
            val opStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
            val parentId = read(i++).toInt()
            val childId = read(i++).toInt()
            removeChild(parentId, childId)
            if (logStartupBreakdown) {
              removeChildNs += System.nanoTime() - opStartNs
              removeChildCount += 1
            }
          }
          5 -> { // dropNode
            if (i >= opCount) break@opLoop
            val opStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
            val nodeId = read(i++).toInt()
            dropNode(nodeId)
            if (logStartupBreakdown) {
              dropNodeNs += System.nanoTime() - opStartNs
              dropNodeCount += 1
            }
          }
          7 -> { // createNode (nodeId, typeStringIndex, hasMeasure)
            if (i + 2 >= opCount) break@opLoop
            val opStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
            val nodeId = read(i++).toInt()
            val typeIndex = read(i++).toInt()
            val hasMeasure = read(i++) != 0.0
            val type = strings.getOrNull(typeIndex) ?: "view"
            createNode(type, nodeId)
            if (logStartupBreakdown) {
              createNodeNs += System.nanoTime() - opStartNs
              createNodeCount += 1
            }
          }
          8 -> { // setSurface (surfaceId)
            if (i >= opCount) break@opLoop
            val opStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
            val surfaceId = read(i++).toInt()
            setSurface(surfaceId)
            if (logStartupBreakdown) {
              setSurfaceNs += System.nanoTime() - opStartNs
              setSurfaceCount += 1
            }
          }
          6 -> { // frame (nodeId, left, top, width, height)
            if (i + 4 >= opCount) break@opLoop
            val opStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
            val nodeId = read(i++).toInt()
            val left = read(i++).toFloat()
            val top = read(i++).toFloat()
            val width = read(i++).toFloat()
            val height = read(i++).toFloat()
            
            // Safety guard: Ignore NaN or Infinity layout values to prevent Skia crashes
            if (left.isNaN() || left.isInfinite() || 
                top.isNaN() || top.isInfinite() || 
                width.isNaN() || width.isInfinite() || 
                height.isNaN() || height.isInfinite()) {
              continue@opLoop
            }

            val view = nodes[nodeId]
            if (view != null) {
              val rLeft = left.toInt()
              val rTop = top.toInt()
              val rRight = (left + width).toInt()
              val rBottom = (top + height).toInt()
              val frameWidth = rRight - rLeft
              val frameHeight = rBottom - rTop
              
              val rect = layoutFrames[nodeId] ?: Rect().also { layoutFrames[nodeId] = it }
              val forceUpdate = view.isLayoutRequested || rect.isEmpty()
              
              if (forceUpdate || rect.left != rLeft || rect.top != rTop || rect.right != rRight || rect.bottom != rBottom) {
                rect.set(rLeft, rTop, rRight, rBottom)
                if (view is ZynthLayoutView) {
                  view.updateYogaLayout(frameWidth, frameHeight)
                }

                val widthMeasureSpec = View.MeasureSpec.makeMeasureSpec(frameWidth, View.MeasureSpec.EXACTLY)
                val heightMeasureSpec = View.MeasureSpec.makeMeasureSpec(frameHeight, View.MeasureSpec.EXACTLY)
                
                val nodeState = nodeStates[nodeId]
                val nodeType = nodeState?.type ?: "unknown"
                val isText = nodeType == "text"
                
                val needsMeasure =
                  forceUpdate ||
                    !isText ||
                    view.measuredWidth != frameWidth ||
                    view.measuredHeight != frameHeight

                if (needsMeasure) {
                  val measureStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
                  if (frameWidth <= 0 || frameHeight <= 0) {
                    val parentId = parents[nodeId] ?: -1
                    val parentType = nodeStates[parentId]?.type ?: "none"
                  }
                  view.measure(widthMeasureSpec, heightMeasureSpec)
                  if (logStartupBreakdown) {
                    frameMeasureNs += System.nanoTime() - measureStartNs
                  }
                }

                val layoutStartNs = if (logStartupBreakdown) System.nanoTime() else 0L
                maybeStartLayoutTransition(nodeId, rLeft, rTop, rRight, rBottom)
                view.layout(rLeft, rTop, rRight, rBottom)
                if (logStartupBreakdown) {
                  frameLayoutNs += System.nanoTime() - layoutStartNs
                }
              }
              
              val surfaceId = nodeSurfaces[nodeId] ?: activeSurfaceId
              if (surfaceId >= 1048576) {
                val nodeType = nodeStates[nodeId]?.type ?: "unknown"
                if (nodeType == "text") {
                  view.invalidate()
                }
              }
              
              if (layoutNodes.contains(nodeId)) {
                noteLayoutDebug("mountFrame:onLayoutNode")
                layoutEventBuffer.add(LayoutEvent(nodeId, pxToDp(left), pxToDp(top), pxToDp(width), pxToDp(height)))
                needsLayout = true
              }
            }
            if (logStartupBreakdown) {
              frameNs += System.nanoTime() - opStartNs
              frameCount += 1
            }
          }
          else -> break@opLoop
        }
      }
    } finally {
      if (logStartupBreakdown) {
        didLogFirstSyncMountBreakdown = true
        val totalMs = (System.nanoTime() - transactionStartNs) / 1_000_000.0
        Log.i(
          STARTUP_TRACE_TAG,
          "phase=kotlin.firstSyncMount totalMs=%.3f opCount=%d createNodeMs=%.3f createNodeCount=%d insertChildMs=%.3f insertChildCount=%d removeChildMs=%.3f removeChildCount=%d setPropMs=%.3f setPropCount=%d setTextMs=%.3f setTextCount=%d frameMs=%.3f frameCount=%d frameMeasureMs=%.3f frameLayoutMs=%.3f setSurfaceMs=%.3f setSurfaceCount=%d dropNodeMs=%.3f dropNodeCount=%d".format(
            totalMs,
            opCount,
            createNodeNs / 1_000_000.0,
            createNodeCount,
            insertChildNs / 1_000_000.0,
            insertChildCount,
            removeChildNs / 1_000_000.0,
            removeChildCount,
            setPropNs / 1_000_000.0,
            setPropCount,
            setTextNs / 1_000_000.0,
            setTextCount,
            frameNs / 1_000_000.0,
            frameCount,
            frameMeasureNs / 1_000_000.0,
            frameLayoutNs / 1_000_000.0,
            setSurfaceNs / 1_000_000.0,
            setSurfaceCount,
            dropNodeNs / 1_000_000.0,
            dropNodeCount,
          )
        )
      }
      endBatch("applyMountTransaction")
      dispatchLayoutEvents()
    }
  }

  private fun beginBatch() {
    batchDepth += 1
  }

  private fun endBatch(source: String = "batch") {
    if (batchDepth == 0) return
    batchDepth -= 1
    if (batchDepth == 0 && batchNeedsLayout) {
      batchNeedsLayout = false
      // Always schedule through Choreographer to coalesce work and avoid long
      // synchronous layout bursts on the main thread at batch boundaries.
      requestLayout("endBatch:$source")
    }
  }

  internal fun isBatching(): Boolean = batchDepth > 0

  internal fun markBatchNeedsLayout(reason: String = "unknown") {
    batchNeedsLayout = true
    noteLayoutDebug("batchNeedsLayout:$reason")
  }

  fun setNativeCommitEnabled(enabled: Boolean) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { setNativeCommitEnabled(enabled) }
      return
    }
    nativeCommitEnabled = enabled
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
    markSurfaceDirty(surfaceId, "setSurface")
  }

  fun flush() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { flush() }
      return
    }
    markSurfaceDirty(activeSurfaceId, "flush")
    requestLayout("flush")
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

  private fun requestLayout(reason: String = "unknown") {
    requestLayoutInternal(reason)
  }

  private fun ensureChoreographer() {
    ensureChoreographerInternal()
  }

  internal fun dpToPx(value: Float): Float = if (density == 0f) value else value * density

  internal fun pxToDp(value: Float): Double = if (density == 0f) value.toDouble() else (value / density).toDouble()

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
    flex: Float,
    flexGrow: Float,
    flexShrink: Float,
    flexBasis: Float,
    top: Float,
    right: Float,
    bottom: Float,
    left: Float,
    padding: Float,
    paddingHorizontal: Float,
    paddingVertical: Float,
    paddingTop: Float,
    paddingRight: Float,
    paddingBottom: Float,
    paddingLeft: Float,
    margin: Float,
    marginHorizontal: Float,
    marginVertical: Float,
    marginTop: Float,
    marginRight: Float,
    marginBottom: Float,
    marginLeft: Float
  ) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain {
        applyAnimatedLayoutStyleInternal(
          nodeId, width, height, minWidth, minHeight, maxWidth, maxHeight,
          flex, flexGrow, flexShrink, flexBasis,
          top, right, bottom, left,
          padding, paddingHorizontal, paddingVertical, paddingTop, paddingRight, paddingBottom, paddingLeft,
          margin, marginHorizontal, marginVertical, marginTop, marginRight, marginBottom, marginLeft
        )
      }
      return
    }
    applyAnimatedLayoutStyleInternal(
      nodeId, width, height, minWidth, minHeight, maxWidth, maxHeight,
      flex, flexGrow, flexShrink, flexBasis,
      top, right, bottom, left,
      padding, paddingHorizontal, paddingVertical, paddingTop, paddingRight, paddingBottom, paddingLeft,
      margin, marginHorizontal, marginVertical, marginTop, marginRight, marginBottom, marginLeft
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
    flex: Float,
    flexGrow: Float,
    flexShrink: Float,
    flexBasis: Float,
    top: Float,
    right: Float,
    bottom: Float,
    left: Float,
    padding: Float,
    paddingHorizontal: Float,
    paddingVertical: Float,
    paddingTop: Float,
    paddingRight: Float,
    paddingBottom: Float,
    paddingLeft: Float,
    margin: Float,
    marginHorizontal: Float,
    marginVertical: Float,
    marginTop: Float,
    marginRight: Float,
    marginBottom: Float,
    marginLeft: Float
  ) {
    val view = nodes[nodeId] ?: return
    val node = nodeStates[nodeId] ?: return
    var layoutParamsChanged = false
    var paddingChanged = false
    var otherChanged = false

    val params = view.layoutParams
    val marginParams = params as? ViewGroup.MarginLayoutParams

    // Batch size updates
    if (params != null) {
      if (width.isFinite()) {
        val next = dpToPx(width).roundToInt()
        if (params.width != next) {
          params.width = next
          layoutParamsChanged = true
        }
      }
      if (height.isFinite()) {
        val next = dpToPx(height).roundToInt()
        if (params.height != next) {
          params.height = next
          layoutParamsChanged = true
        }
      }
    }

    // Min/Max constraints
    if (minWidth.isFinite()) {
      val next = dpToPx(minWidth).roundToInt()
      if (view.minimumWidth != next) {
        view.minimumWidth = next
        otherChanged = true
      }
    }
    if (minHeight.isFinite()) {
      val next = dpToPx(minHeight).roundToInt()
      if (view.minimumHeight != next) {
        view.minimumHeight = next
        otherChanged = true
      }
    }

    // Padding application
    var nextPaddingLeft = view.paddingLeft
    var nextPaddingTop = view.paddingTop
    var nextPaddingRight = view.paddingRight
    var nextPaddingBottom = view.paddingBottom

    if (padding.isFinite()) {
      val p = dpToPx(padding).roundToInt()
      nextPaddingLeft = p; nextPaddingTop = p; nextPaddingRight = p; nextPaddingBottom = p
      paddingChanged = true
    }
    if (paddingHorizontal.isFinite()) {
      val ph = dpToPx(paddingHorizontal).roundToInt()
      nextPaddingLeft = ph; nextPaddingRight = ph
      paddingChanged = true
    }
    if (paddingVertical.isFinite()) {
      val pv = dpToPx(paddingVertical).roundToInt()
      nextPaddingTop = pv; nextPaddingBottom = pv
      paddingChanged = true
    }
    if (paddingTop.isFinite()) {
      nextPaddingTop = dpToPx(paddingTop).roundToInt()
      paddingChanged = true
    }
    if (paddingRight.isFinite()) {
      nextPaddingRight = dpToPx(paddingRight).roundToInt()
      paddingChanged = true
    }
    if (paddingBottom.isFinite()) {
      nextPaddingBottom = dpToPx(paddingBottom).roundToInt()
      paddingChanged = true
    }
    if (paddingLeft.isFinite()) {
      nextPaddingLeft = dpToPx(paddingLeft).roundToInt()
      paddingChanged = true
    }

    // Margin application
    if (marginParams != null) {
      if (margin.isFinite()) {
        val m = dpToPx(margin).roundToInt()
        if (marginParams.leftMargin != m || marginParams.topMargin != m || 
            marginParams.rightMargin != m || marginParams.bottomMargin != m) {
          marginParams.leftMargin = m; marginParams.topMargin = m
          marginParams.rightMargin = m; marginParams.bottomMargin = m
          layoutParamsChanged = true
        }
      }
      if (marginHorizontal.isFinite()) {
        val mh = dpToPx(marginHorizontal).roundToInt()
        if (marginParams.leftMargin != mh || marginParams.rightMargin != mh) {
          marginParams.leftMargin = mh; marginParams.rightMargin = mh
          layoutParamsChanged = true
        }
      }
      if (marginVertical.isFinite()) {
        val mv = dpToPx(marginVertical).roundToInt()
        if (marginParams.topMargin != mv || marginParams.bottomMargin != mv) {
          marginParams.topMargin = mv; marginParams.bottomMargin = mv
          layoutParamsChanged = true
        }
      }
      if (marginTop.isFinite()) {
        val m = dpToPx(marginTop).roundToInt()
        if (marginParams.topMargin != m) {
          marginParams.topMargin = m
          layoutParamsChanged = true
        }
      }
      if (marginRight.isFinite()) {
        val m = dpToPx(marginRight).roundToInt()
        if (marginParams.rightMargin != m) {
          marginParams.rightMargin = m
          layoutParamsChanged = true
        }
      }
      if (marginBottom.isFinite()) {
        val m = dpToPx(marginBottom).roundToInt()
        if (marginParams.bottomMargin != m) {
          marginParams.bottomMargin = m
          layoutParamsChanged = true
        }
      }
      if (marginLeft.isFinite()) {
        val m = dpToPx(marginLeft).roundToInt()
        if (marginParams.leftMargin != m) {
          marginParams.leftMargin = m
          layoutParamsChanged = true
        }
      }
    }

    // Apply changes in a single pass
    if (layoutParamsChanged) {
      view.layoutParams = params
    }
    if (paddingChanged) {
      view.setPadding(nextPaddingLeft, nextPaddingTop, nextPaddingRight, nextPaddingBottom)
    }

    if (layoutParamsChanged || paddingChanged || otherChanged) {

      // For text nodes, frequent layout marking can disrupt the measurement cache.
      // We only mark dirty if the properties actually affect intrinsic measurement.
      val isText = node.type == "text"
      val affectsIntrinsic = paddingChanged || layoutParamsChanged
      
      if (affectsIntrinsic) {
        markNodeDirty(nodeId)
      }
      
      if (!isText || affectsIntrinsic) {
        markSurfaceDirtyForNode(nodeId, "animatedLayoutStyle")
      }
      
      // Request layout but coalesce with Choreographer if possible
      if (isBatching()) {
        markBatchNeedsLayout("animatedLayoutStyle")
      } else {
        view.requestLayout()
      }
      view.invalidate()
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

  private val customMeasureHandlers = HashMap<Int, com.zynth.kit.layout.MeasureHandler>()

  private inner class LayoutEngineAdapter : LayoutEngine {
    override fun createNode(id: Int) {}

    override fun removeNode(id: Int) {
      customMeasureHandlers.remove(id)
    }

    override fun insertChild(parent: Int, child: Int, index: Int) {}

    override fun setStyle(id: Int, style: com.zynth.kit.layout.Style) {}

    override fun calculateLayout(width: Int, height: Int) {}

    override fun calculateLayoutForNode(nodeId: Int, width: Float, height: Float) {}

    override fun frame(id: Int): LayoutRect {
      val view = nodes[id] ?: return LayoutRect(0, 0, 0, 0)
      return LayoutRect(view.left, view.top, view.right, view.bottom)
    }

    override fun getAllFrames(): Map<Int, LayoutRect> {
      val frames = HashMap<Int, LayoutRect>(nodes.size)
      for ((id, view) in nodes) {
        frames[id] = LayoutRect(view.left, view.top, view.right, view.bottom)
      }
      return frames
    }

    override fun setMeasureHandler(id: Int, handler: MeasureHandler?) {
      if (handler == null) {
        customMeasureHandlers.remove(id)
      } else {
        customMeasureHandlers[id] = handler
      }
    }

    override fun getMeasureHandler(id: Int): MeasureHandler? {
      return customMeasureHandlers[id]
    }

    override fun markDirty(id: Int) {
      markSurfaceDirtyForNode(id, "layoutEngine:markDirty")
    }
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
      "flexDirection", "justifyContent", "alignItems", "alignSelf", "alignContent",
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
      if (applyTypedTextNumberProp(nodeId, propId, payload)) {
        return true
      }
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
        40 -> { setProp(nodeId, "display", payload); return true }
        41 -> { setProp(nodeId, "overflow", payload); return true }
        44 -> { setProp(nodeId, "backgroundColor", payload); return true }
        45 -> { setProp(nodeId, "borderColor", payload); return true }
        47 -> { setProp(nodeId, "borderRadius", payload); return true }
        48 -> { setProp(nodeId, "borderWidth", payload); return true }
        49 -> { setProp(nodeId, "borderTopWidth", payload); return true }
        50 -> { setProp(nodeId, "borderRightWidth", payload); return true }
        51 -> { setProp(nodeId, "borderBottomWidth", payload); return true }
        52 -> { setProp(nodeId, "borderLeftWidth", payload); return true }
        53 -> { setProp(nodeId, "borderTopLeftRadius", payload); return true }
        54 -> { setProp(nodeId, "borderTopRightRadius", payload); return true }
        55 -> { setProp(nodeId, "borderBottomRightRadius", payload); return true }
        56 -> { setProp(nodeId, "borderBottomLeftRadius", payload); return true }
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
      if (applyTypedTextStringProp(nodeId, propId, value)) {
        return true
      }
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
        114 -> { setProp(nodeId, "borderTopColor", value); return true }
        115 -> { setProp(nodeId, "borderRightColor", value); return true }
        116 -> { setProp(nodeId, "borderBottomColor", value); return true }
        117 -> { setProp(nodeId, "borderLeftColor", value); return true }
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
