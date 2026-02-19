package com.zynth.kit.core

import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import java.nio.ByteBuffer
import java.nio.ByteOrder
import android.os.SystemClock
import android.view.Choreographer
import android.view.Gravity
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
import com.zynth.kit.layout.ZynthYogaLayout
import com.zynth.kit.runtime.JSBridge
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.roundToInt

// TODO: Move this to a separate file or optimize
private const val TRACE_TAG = "ZynthUIManager"
private const val DEFAULT_PERSPECTIVE = 500f
private const val DEBUG_TEXT = false
private const val DEBUG_TEXT_DIRTY = false
private const val DEBUG_CPP_LAYOUT_DIAGNOSTICS = true

private val STYLE_PROP_ID_TO_NAME = mapOf(
  100 to "backgroundColor",
  101 to "opacity",
  102 to "borderRadius",
  103 to "borderWidth",
  104 to "borderColor",
  105 to "shadowColor",
  106 to "shadowOffset",
  107 to "shadowOpacity",
  108 to "shadowRadius",
  109 to "elevation"
)

class ZynthUIManager(internal val rootView: ZynthRootView) : ZynthEventSink {
  internal var runtimePtr: Long = 0L
  internal val mainHandler = Handler(Looper.getMainLooper())
  internal val density = rootView.resources.displayMetrics.density
  internal var nextId = 1
  internal val nodes = HashMap<Int, View>()
  internal val nodeStates = HashMap<Int, Node>()
  internal val parents = HashMap<Int, Int>()
  internal val children = HashMap<Int, MutableList<Int>>()
  internal val nodeSurfaces = HashMap<Int, Int>()
  internal val surfaceRoots = HashMap<Int, ViewGroup>()
  internal val surfaceYoga = HashMap<Int, ZynthYogaLayout>()
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
  internal val cppLayoutAppliedSurfaces = HashSet<Int>()
  internal val textStyleStates = HashMap<Int, ZynthTextStyleState>()
  internal val yogaStyleCache = HashMap<Int, MutableMap<String, Any?>>()
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
  internal val touchListeners = HashMap<Int, View.OnTouchListener>()
  internal val layoutNodes = ConcurrentHashMap.newKeySet<Int>()
  internal val layoutPending = ConcurrentHashMap.newKeySet<Int>()
  internal val layoutDirtyNodes = ConcurrentHashMap.newKeySet<Int>()
  internal val layoutFrames = HashMap<Int, android.graphics.Rect>()
  internal val layoutTransitionFrames = HashMap<Int, android.graphics.Rect>()
  internal val pendingInitialLayoutNodes = HashSet<Int>()
  internal val layoutEventBuffer = ArrayList<LayoutEvent>(64)
  internal var layoutPayloadBuffer = DoubleArray(320)
  internal var yogaMeasureDebugCount = 0

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
  internal val frameCallback = Choreographer.FrameCallback { handleFrame() }
  private val layoutEngine: LayoutEngine = LayoutEngineAdapter()
  private data class TimerEntry(
    val handler: Handler,
    val runnable: Runnable,
  )
  private val timerEntries = HashMap<Int, TimerEntry>()
  private val animationFrameCallbacks = HashMap<Int, Choreographer.FrameCallback>()
  internal var jsHandler: Handler? = null
  private val mainQueue = ArrayDeque<() -> Unit>()
  private var mainQueueScheduled = false
  private val mainQueueLock = Any()
  private val mainQueueMaxOpsPerTick = 100000
  private val mainQueueMaxMsPerTick = 16.0
  internal val layoutApplyBudgetMs = 8.0
  private val traceEnabled = false
  private val traceIntervalMs = 500L
  private var traceStartMs = SystemClock.uptimeMillis()
  private var traceLastLogMs = traceStartMs
  private var lastDrainOps = 0
  private var lastDrainMs = 0.0
  internal var perfFrameCount = 0
  internal var perfLastLogMs = traceStartMs
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
  private data class OpStats(var count: Int = 0, var ns: Long = 0L)
  private val opStats = HashMap<String, OpStats>()
  private val typeStats = HashMap<String, OpStats>()
  private val phaseStats = HashMap<String, OpStats>()
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
    val maxMs = mainQueueMaxMsPerTick
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
    val elapsedMs = (System.nanoTime() - startNs) / 1_000_000.0
    lastDrainOps = processed
    lastDrainMs = elapsedMs
    maybeLogTrace("drain")
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
    val create = {
      val startNs = System.nanoTime()
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
      // Log.d("ZynthLifecycle", "createNode id=$id type=$type")
      nodeStates[id] = node
      pointerEvents[id] = "auto"
      nodeSurfaces[id] = activeSurfaceId
      yogaForSurface(activeSurfaceId).ensureNode(id, view)
      markSurfaceDirty(activeSurfaceId)
      descriptor?.onNodeCreated?.invoke(this, node)
      traceOp("createNode", type, startNs)
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      create()
    } else {
      val latch = CountDownLatch(1)
      runOnMain {
        create()
        latch.countDown()
      }
      val completed = latch.await(120, TimeUnit.MILLISECONDS)
      if (!completed) {
        Log.w("ZynthUI", "createNode timeout id=$id type=$type")
      }
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
    val descriptor = node?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    
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
      yogaForNode(id).setStyle(id, name, scaled)
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
    val descriptor = node?.let { ZynthComponentRegistry.getDescriptor(it.type) }
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
        runOnMain { view.setTextColor(color) }
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
      runOnMain { view.alpha = alpha }
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontSize") {
      val size = value?.toFloatOrNull() ?: return
      runOnMain { view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, dpToPx(size)) }
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
      runOnMain { view.setTypeface(view.typeface, style) }
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontStyle") {
      val style = if (value == "italic") Typeface.ITALIC else Typeface.NORMAL
      runOnMain { view.setTypeface(view.typeface, style) }
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (view is TextView && name == "fontFamily") {
      if (value == null) {
        runOnMain { view.typeface = Typeface.DEFAULT }
        maybeNotifyStyle(descriptor, node, name, value)
        traceOp("setProp", node?.type, startNs)
        return
      }
      val family = value
      runOnMain {
        val custom = assetProvider?.getTypeface(family)
        val style = view.typeface?.style ?: Typeface.NORMAL
        if (custom != null) {
          // If it's an icon font, we MUST use the typeface directly.
          // Typeface.create(custom, style) can fail to preserve the glyphs if the style (e.g. Bold) isn't supported by the font file.
          if (family.contains("Icon")) {
             view.typeface = custom
          } else {
             view.typeface = Typeface.create(custom, style)
          }
        } else {
          view.typeface = Typeface.create(family, style)
        }
      }
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
      runOnMain { view.gravity = gravity }
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "width") {
      val scaled = scaleYogaValue(name, value)
      cacheYogaStyle(id, "width", scaled)
      yogaForNode(id).setStyle(id, "width", scaled)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "height") {
      val scaled = scaleYogaValue(name, value)
      cacheYogaStyle(id, "height", scaled)
      yogaForNode(id).setStyle(id, "height", scaled)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "flexDirection") {
      cacheYogaStyle(id, "flexDirection", value)
      yogaForNode(id).setStyle(id, "flexDirection", value)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    val scaled = scaleYogaValue(name, value)
    cacheYogaStyle(id, name, scaled)
    yogaForNode(id).setStyle(id, name, scaled)
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
    val descriptor = node?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    val handledByDescriptor =
      if (node != null) descriptor?.applyProperty?.invoke(node, "text", text) == true else false
    if (!handledByDescriptor && view is TextView) {
      node?.cachedText = text
      applyTextValue(id, view, text)
      yogaForNode(id).markDirty(id)
      markSurfaceDirtyForNode(id)
    }
    traceOp("setText", node?.type, startNs)
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
    val isFirstMount = previousParentId == null
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
      yogaForSurface(surfaceId).ensureNode(childId, child)
    }

    val descriptor = parentState?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (descriptor != null && nodeStates[childId] != null) {
      descriptor.onChildInserted(this, parentState!!, nodeStates[childId]!!, index)
    }

    if (parent is TextView && child is TextView) {
      // Text composition is handled by the descriptor via updateComposedText
      yogaForNode(parentId).markDirty(parentId)
      markSurfaceDirty(surfaceId)
      traceOp("insertChild", parentState?.type, startNs)
      return
    }
    val group = parent as? ViewGroup
    if (group == null) {
      val yogaParentId = if (isSurfaceRoot) 0 else parentId
      yogaForSurface(surfaceId).insertChild(yogaParentId, childId, index)
      return
    }
    runOnMain {
      if (isFirstMount) {
        pendingInitialLayoutNodes.add(childId)
        child.visibility = View.INVISIBLE
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
    }
    val yogaParentId = if (isSurfaceRoot) 0 else parentId
    yogaForSurface(surfaceId).insertChild(yogaParentId, childId, index)
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
    runOnMain { (child.parent as? ViewGroup)?.removeView(child) }
    val yogaParentId = if (isSurfaceRootId(parentId)) 0 else parentId
    yogaForNode(childId).removeChild(yogaParentId, childId)
    markSurfaceDirtyForNode(childId)
    traceOp("removeChild", parentState?.type, startNs)
  }

  fun dropNode(nodeId: Int) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { dropNode(nodeId) }
      return
    }
    destroyNode(nodeId)
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

  fun getRootWidth(): Int = rootView.width
  fun getRootHeight(): Int = rootView.height
  fun getDensity(): Float = density

  fun measureNodeForYoga(
    nodeId: Int,
    width: Float,
    widthMode: Int,
    height: Float,
    heightMode: Int
  ): Long {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return measureNodeForYogaOnMain(nodeId, width, widthMode, height, heightMode)
    }
    var packed = 0L
    val latch = CountDownLatch(1)
    runOnMain {
      packed = measureNodeForYogaOnMain(nodeId, width, widthMode, height, heightMode)
      latch.countDown()
    }
    val completed = latch.await(120, TimeUnit.MILLISECONDS)
    if (!completed) {
      Log.w("ZynthUI", "measureNodeForYoga timeout node=$nodeId width=$width/$widthMode height=$height/$heightMode")
    }
    return packed
  }

  private fun measureNodeForYogaOnMain(
    nodeId: Int,
    width: Float,
    widthMode: Int,
    height: Float,
    heightMode: Int
  ): Long {
    val view = nodes[nodeId] ?: return 0L
    val widthSpec = when (widthMode) {
      1 -> View.MeasureSpec.makeMeasureSpec(width.toInt().coerceAtLeast(0), View.MeasureSpec.EXACTLY)
      2 -> View.MeasureSpec.makeMeasureSpec(width.toInt().coerceAtLeast(0), View.MeasureSpec.AT_MOST)
      else -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    }
    val heightSpec = when (heightMode) {
      1 -> View.MeasureSpec.makeMeasureSpec(height.toInt().coerceAtLeast(0), View.MeasureSpec.EXACTLY)
      2 -> View.MeasureSpec.makeMeasureSpec(height.toInt().coerceAtLeast(0), View.MeasureSpec.AT_MOST)
      else -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    }
    view.measure(widthSpec, heightSpec)
    val measuredWidth = view.measuredWidth.coerceAtLeast(0)
    val measuredHeight = view.measuredHeight.coerceAtLeast(0)
    if (yogaMeasureDebugCount < 80 && view is TextView) {
      yogaMeasureDebugCount += 1
      Log.d(
        "ZynthUI",
        "measureNodeForYoga text node=$nodeId measured=${measuredWidth}x$measuredHeight width=$width/$widthMode height=$height/$heightMode textLen=${view.text?.length ?: 0}"
      )
    }
    return (measuredWidth.toLong() shl 32) or (measuredHeight.toLong() and 0xffffffffL)
  }

  fun applyLayoutResults(results: FloatArray) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { applyLayoutResults(results) }
      return
    }
    // Log.d("ZynthUI", "applyLayoutResults: processing ${results.size / 5} node frames on main thread")
    val touchedSurfaces = HashSet<Int>()
    var changedCount = 0
    var zeroAreaCount = 0
    var i = 0
    while (i < results.size) {
      val nodeId = results[i++].toInt()
      val left = results[i++]
      val top = results[i++]
      val width = results[i++]
      val height = results[i++]
      
      val view = nodes[nodeId] ?: continue
      val surfaceId = nodeSurfaces[nodeId] ?: activeSurfaceId
      touchedSurfaces.add(surfaceId)
      val l = left.toInt()
      val t = top.toInt()
      val w = width.toInt()
      val h = height.toInt()
      val r = l + w
      val b = t + h
      if (w <= 0 || h <= 0) {
        zeroAreaCount += 1
      }
      
      if (view is ZynthLayoutView) {
        view.updateYogaLayout(w, h)
      }

      if (view.left != l || view.top != t || view.right != r || view.bottom != b) {
        view.layout(l, t, r, b)
        changedCount += 1
        if (pendingInitialLayoutNodes.remove(nodeId)) {
          view.visibility = View.VISIBLE
        }
        if (layoutNodes.contains(nodeId)) {
          layoutDirtyNodes.add(nodeId)
        }
        if (styleStates.containsKey(nodeId)) {
          styleLayoutDirtyNodes.add(nodeId)
          styleLayoutFrames[nodeId] = android.graphics.Rect(l, t, r, b)
        }
      }
    }
    if (touchedSurfaces.isNotEmpty()) {
      cppLayoutAppliedSurfaces.addAll(touchedSurfaces)
    }
    if (DEBUG_CPP_LAYOUT_DIAGNOSTICS) {
      Log.d(
        "ZynthUI",
        "applyLayoutResults(Kotlin): frames=${results.size / 5} changed=$changedCount zeroArea=$zeroAreaCount touchedSurfaces=${touchedSurfaces.joinToString(",")}"
      )
    }
  }

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
    val yoga = yogaForNode(nodeId)
    val overlap = overlapPx.coerceAtLeast(0f)

    if (overlap <= 0f) {
      if (behavior == "padding") {
        val original = yogaStyleCache[nodeId]?.get("paddingBottom")
        when (original) {
          is Float -> yoga.setStyle(nodeId, "paddingBottom", original)
          is String -> yoga.setStyle(nodeId, "paddingBottom", original)
          else -> yoga.setStyle(nodeId, "paddingBottom", "0")
        }
      } else if (behavior == "height") {
        val original = yogaStyleCache[nodeId]?.get("marginBottom")
        when (original) {
          is Float -> yoga.setStyle(nodeId, "marginBottom", original)
          is String -> yoga.setStyle(nodeId, "marginBottom", original)
          else -> yoga.setStyle(nodeId, "marginBottom", "0")
        }
      }
      markSurfaceDirtyForNode(nodeId)
      return
    }

    if (behavior == "padding") {
      val base = getCachedFloat(nodeId, "paddingBottom")
      yoga.setStyle(nodeId, "paddingBottom", base + overlap)
    } else if (behavior == "height") {
       val base = getCachedFloat(nodeId, "marginBottom")
       yoga.setStyle(nodeId, "marginBottom", base + overlap)
    }
    markSurfaceDirtyForNode(nodeId)
  }

  private fun getCachedFloat(nodeId: Int, name: String): Float {
    val value = yogaStyleCache[nodeId]?.get(name) ?: return 0f
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
  fun markNodeDirty(nodeId: Int) {
    if (DEBUG_TEXT_DIRTY) {
      Log.d("ZynthText", "markNodeDirty node=$nodeId\n${Throwable().stackTraceToString()}")
    }
    layoutEngine.markDirty(nodeId)
    requestLayout()
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
      val latch = CountDownLatch(1)
      runOnMain {
        applyBatchTypedPacked(ops, strings)
        latch.countDown()
      }
      latch.await(120, TimeUnit.MILLISECONDS)
      return
    }
    beginBatch()
    var i = 0
    while (i < ops.size) {
      val opcode = ops[i++].toInt()
      when (opcode) {
        1 -> { // setProp
          if (i + 3 >= ops.size) return
          val nodeId = ops[i++].toInt()
          val propIdOrIndex = ops[i++].toInt()
          val valueType = ops[i++].toInt()
          val payload = ops[i++]
          
          if (propIdOrIndex > 0 && propIdOrIndex < 100) {
            // Already handled in C++ Style Engine
            continue
          }
          
          val key = if (propIdOrIndex >= 100) {
            STYLE_PROP_ID_TO_NAME[propIdOrIndex] ?: ""
          } else {
            strings.getOrNull(if (propIdOrIndex < 0) -propIdOrIndex else propIdOrIndex) ?: ""
          }
          
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
          if (i + 1 >= ops.size) return
          val nodeId = ops[i++].toInt()
          val textIndex = ops[i++].toInt()
          val text = strings.getOrNull(textIndex) ?: ""
          setText(nodeId, text)
        }
        3 -> { // insertChild
          if (i + 2 >= ops.size) return
          val parentId = ops[i++].toInt()
          val childId = ops[i++].toInt()
          val index = ops[i++].toInt()
          insertChild(parentId, childId, index)
        }
        4 -> { // removeChild
          if (i + 1 >= ops.size) return
          val parentId = ops[i++].toInt()
          val childId = ops[i++].toInt()
          removeChild(parentId, childId)
        }
        5 -> { // dropNode
          if (i + 1 >= ops.size) return
          val nodeId = ops[i++].toInt()
          dropNode(nodeId)
        }
        else -> return
      }
    }
    endBatch()
  }

  fun applyBatchTypedBuffer(buffer: ByteBuffer, opCount: Int, strings: Array<String?>) {
    val ops = buffer.order(ByteOrder.nativeOrder())
    if (Looper.myLooper() != Looper.getMainLooper()) {
      val copied = DoubleArray(opCount)
      for (i in 0 until opCount) {
        copied[i] = ops.getDouble(i * 8)
      }
      val latch = CountDownLatch(1)
      runOnMain {
        applyBatchTypedPacked(copied, strings)
        latch.countDown()
      }
      latch.await(120, TimeUnit.MILLISECONDS)
      return
    }
    beginBatch()
    var i = 0
    fun read(idx: Int): Double = ops.getDouble(idx * 8)
    while (i < opCount) {
      val opcode = read(i++).toInt()
      when (opcode) {
        1 -> { // setProp
          if (i + 3 >= opCount) return
          val nodeId = read(i++).toInt()
          val propIdOrIndex = read(i++).toInt()
          val valueType = read(i++).toInt()
          val payload = read(i++)
          
          if (propIdOrIndex > 0 && propIdOrIndex < 100) {
            // Already handled in C++ Style Engine
            continue
          }
          
          val key = if (propIdOrIndex >= 100) {
            STYLE_PROP_ID_TO_NAME[propIdOrIndex] ?: ""
          } else {
            strings.getOrNull(if (propIdOrIndex < 0) -propIdOrIndex else propIdOrIndex) ?: ""
          }
          
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
          if (i + 1 >= opCount) return
          val nodeId = read(i++).toInt()
          val textIndex = read(i++).toInt()
          val text = strings.getOrNull(textIndex) ?: ""
          setText(nodeId, text)
        }
        3 -> { // insertChild
          if (i + 2 >= opCount) return
          val parentId = read(i++).toInt()
          val childId = read(i++).toInt()
          val index = read(i++).toInt()
          insertChild(parentId, childId, index)
        }
        4 -> { // removeChild
          if (i + 1 >= opCount) return
          val parentId = read(i++).toInt()
          val childId = read(i++).toInt()
          removeChild(parentId, childId)
        }
        5 -> { // dropNode
          if (i + 1 >= opCount) return
          val nodeId = read(i++).toInt()
          dropNode(nodeId)
        }
        else -> return
      }
    }
    endBatch()
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

  fun markBatchNeedsLayout() {
    batchNeedsLayout = true
  }

  internal fun markBatchNeedsLayoutInternal() {
    batchNeedsLayout = true
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
    if (!traceEnabled) return
    val stats = phaseStats.getOrPut(name) { OpStats() }
    stats.count += 1
    stats.ns += durationNs
  }

  private fun traceOp(op: String, type: String?, startNs: Long) {
    if (!traceEnabled) return
    val durationNs = System.nanoTime() - startNs
    val opStatsEntry = opStats.getOrPut(op) { OpStats() }
    opStatsEntry.count += 1
    opStatsEntry.ns += durationNs
    val typeKey = type ?: "unknown"
    val typeStatsEntry = typeStats.getOrPut(typeKey) { OpStats() }
    typeStatsEntry.count += 1
    typeStatsEntry.ns += durationNs
  }

  private fun maybeLogTrace(reason: String) {
    if (!traceEnabled) return
    val now = SystemClock.uptimeMillis()
    if (now - traceLastLogMs < traceIntervalMs) return
    traceLastLogMs = now
    val sinceStartMs = now - traceStartMs
    val queueSize = synchronized(mainQueueLock) { mainQueue.size }
    val opSnapshot = opStats.toList()
    val typeSnapshot = typeStats.toList()
    val phaseSnapshot = phaseStats.toList()
    opStats.clear()
    typeStats.clear()
    phaseStats.clear()
    val topTypes = typeSnapshot.sortedByDescending { it.second.ns }.take(6)
    val topOps = opSnapshot.sortedByDescending { it.second.ns }.take(6)
    val topPhases = phaseSnapshot.sortedByDescending { it.second.ns }.take(6)
    val typeSummary = topTypes.joinToString { (key, stat) ->
      "%s %.2fms/%d".format(key, stat.ns / 1_000_000.0, stat.count)
    }
    val opSummary = topOps.joinToString { (key, stat) ->
      "%s %.2fms/%d".format(key, stat.ns / 1_000_000.0, stat.count)
    }
    val phaseSummary = topPhases.joinToString { (key, stat) ->
      "%s %.2fms/%d".format(key, stat.ns / 1_000_000.0, stat.count)
    }
    Log.d(
      "ZynthUI",
      "trace %dms reason=%s queue=%d drain=%.2fms/%d ops=[%s] types=[%s] phases=[%s]".format(
        sinceStartMs,
        reason,
        queueSize,
        lastDrainMs,
        lastDrainOps,
        opSummary,
        typeSummary,
        phaseSummary
      )
    )
  }

  private fun requestLayout() {
    requestLayoutInternal()
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

  private fun cacheYogaStyle(id: Int, name: String, value: Any?) {
    val styles = yogaStyleCache.getOrPut(id) { HashMap() }
    styles[name] = value
  }

  private fun reapplyYogaStyles(id: Int, surfaceId: Int) {
    val styles = yogaStyleCache[id] ?: return
    val layout = yogaForSurface(surfaceId)
    for ((name, value) in styles) {
      when (value) {
        is Float -> layout.setStyle(id, name, value)
        is String -> layout.setStyle(id, name, value)
      }
    }
  }

  private fun moveSubtreeToSurface(nodeId: Int, surfaceId: Int, parentId: Int, index: Int) {
    val view = nodes[nodeId] ?: return
    val previousSurfaceId = nodeSurfaces[nodeId]
    if (previousSurfaceId != null && previousSurfaceId != surfaceId) {
      surfaceYoga[previousSurfaceId]?.removeNode(nodeId)
    }
    nodeSurfaces[nodeId] = surfaceId
    val layout = yogaForSurface(surfaceId)
    layout.ensureNode(nodeId, view)
    reapplyYogaStyles(nodeId, surfaceId)
    val yogaParentId = if (parentId == 0 || isSurfaceRootId(parentId)) 0 else parentId
    layout.insertChild(yogaParentId, nodeId, index)

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
        val previous = yogaStyleCache[nodeId]?.get(name) as? Float
        if (previous != null && kotlin.math.abs(previous - px) < 0.5f) {
          Unit
        } else {
          cacheYogaStyle(nodeId, name, px)
          yogaForNode(nodeId).setStyle(nodeId, name, px)
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

  private inner class LayoutEngineAdapter : LayoutEngine {
    override fun createNode(id: Int) {
      nodes[id]?.let { yogaForNode(id).ensureNode(id, it) }
    }

    override fun removeNode(id: Int) {
      yogaForNode(id).removeNode(id)
    }

    override fun insertChild(parent: Int, child: Int, index: Int) {
      yogaForNode(child).insertChild(parent, child, index)
    }

    override fun setStyle(id: Int, style: com.zynth.kit.layout.Style) {
      style
    }

    override fun calculateLayout(width: Int, height: Int) {
      width
      height
    }

    override fun calculateLayoutForNode(nodeId: Int, width: Float, height: Float) {
      nodeId
      width
      height
    }

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
      yogaForNode(id).setMeasureHandler(id, handler)
    }

    override fun markDirty(id: Int) {
      yogaForNode(id).markDirty(id)
      markSurfaceDirtyForNode(id)
    }
  }

  private fun maybeNotifyStyle(
    descriptor: com.zynth.kit.components.ZynthComponentDescriptor?,
    node: Node?,
    name: String,
    value: String?
  ) {
    if (descriptor == null || node == null || value == null) return
    val style = styleFromProp(name, value) ?: return
    descriptor.onStyleApplied(node, style)
  }

  private fun styleFromProp(name: String, rawValue: String): Style? {
    val trimmed = rawValue.trim()
    val jsonValue = when {
      trimmed.isEmpty() -> JSONObject.quote("")
      trimmed == "true" || trimmed == "false" -> trimmed
      trimmed.toDoubleOrNull() != null -> trimmed
      trimmed.startsWith("{") || trimmed.startsWith("[") -> trimmed
      else -> JSONObject.quote(trimmed)
    }
    val json = "{\"$name\":$jsonValue}"
    return runCatching { Style.fromJson(json) }.getOrNull()
  }
}
