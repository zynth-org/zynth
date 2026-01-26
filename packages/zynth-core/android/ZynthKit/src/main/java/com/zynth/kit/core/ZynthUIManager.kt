package com.zynth.kit.core

import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
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
import java.util.concurrent.ConcurrentHashMap

class ZynthUIManager(internal val rootView: ZynthRootView) : ZynthEventSink {
  internal val mainHandler = Handler(Looper.getMainLooper())
  internal val density = rootView.resources.displayMetrics.density
  internal var nextId = 1
  internal val nodes = HashMap<Int, View>()
  internal val nodeStates = HashMap<Int, Node>()
  internal val parents = HashMap<Int, Int>()
  internal val nodeSurfaces = HashMap<Int, Int>()
  internal val surfaceRoots = HashMap<Int, ViewGroup>()
  internal val surfaceYoga = HashMap<Int, ZynthYogaLayout>()
  internal val dirtySurfaces = HashSet<Int>()
  internal val surfaceSizes = HashMap<Int, Pair<Int, Int>>()
  internal var activeSurfaceId = 0
  internal val styleStates = HashMap<Int, ZynthViewStyleState>()
  internal val styleDirtyNodes = HashSet<Int>()
  internal val styleLayoutDirtyNodes = HashSet<Int>()
  internal val styleLayoutFrames = HashMap<Int, android.graphics.Rect>()
  internal val textStyleStates = HashMap<Int, ZynthTextStyleState>()
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
  internal val layoutFrames = HashMap<Int, android.graphics.Rect>()
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
  private val timerRunnables = HashMap<Int, Runnable>()
  internal var jsHandler: Handler? = null
  private val mainQueue = ArrayDeque<() -> Unit>()
  private var mainQueueScheduled = false
  private val mainQueueLock = Any()
  private val mainQueueMinOpsPerTick = 200
  private val mainQueueMaxOpsPerTick = 2000
  private val mainQueueMaxMsPerTick = 6.0
  private val traceEnabled = true
  private val traceIntervalMs = 500L
  private var traceStartMs = SystemClock.uptimeMillis()
  private var traceLastLogMs = traceStartMs
  private var lastDrainOps = 0
  private var lastDrainMs = 0.0
  private var batchDepth = 0
  private var batchNeedsLayout = false
  private data class OpStats(var count: Int = 0, var ns: Long = 0L)
  private val opStats = HashMap<String, OpStats>()
  private val typeStats = HashMap<String, OpStats>()
  private val phaseStats = HashMap<String, OpStats>()

  fun scheduleTimer(runtimePtr: Long, timerId: Int, delayMs: Int, repeat: Boolean) {
    val runnable = object : Runnable {
      override fun run() {
        runOnJS {
          JSBridge.invokeTimer(runtimePtr, timerId)
        }
        if (repeat) {
          mainHandler.postDelayed(this, delayMs.toLong())
        } else {
          timerRunnables.remove(timerId)
        }
      }
    }
    timerRunnables[timerId] = runnable
    mainHandler.postDelayed(runnable, delayMs.toLong())
  }

  fun cancelTimer(timerId: Int) {
    timerRunnables.remove(timerId)?.let {
      mainHandler.removeCallbacks(it)
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
  )

  init {
    ensureSurface(0)
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
      if (processed >= mainQueueMinOpsPerTick && elapsedMs >= mainQueueMaxMsPerTick) {
        break
      }
    }
    val elapsedMs = (System.nanoTime() - startNs) / 1_000_000.0
    lastDrainOps = processed
    lastDrainMs = elapsedMs
    maybeLogTrace("drain")
    mainHandler.post { drainMainQueue() }
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
      runOnMain { create() }
    }
    return id
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
    if (name == "color" && view is TextView) {
      ZynthColorParser.parse(value)?.let { color ->
        runOnMain { view.setTextColor(color) }
      }
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "pointerEvents") {
      if (value.isNullOrBlank()) {
        pointerEvents.remove(id)
        nodeStates[id]?.pointerEvents = "auto"
      } else {
        pointerEvents[id] = value
        nodeStates[id]?.pointerEvents = value
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
      val family = value ?: return
      runOnMain { view.typeface = Typeface.create(family, view.typeface?.style ?: Typeface.NORMAL) }
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
      yogaForNode(id).setStyle(id, "width", scaleYogaValue(name, value))
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "height") {
      yogaForNode(id).setStyle(id, "height", scaleYogaValue(name, value))
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    if (name == "flexDirection") {
      yogaForNode(id).setStyle(id, "flexDirection", value)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      traceOp("setProp", node?.type, startNs)
      return
    }
    yogaForNode(id).setStyle(id, name, scaleYogaValue(name, value))
    markSurfaceDirtyForNode(id)
    maybeNotifyStyle(descriptor, node, name, value)
    traceOp("setProp", node?.type, startNs)
  }

  fun setText(id: Int, text: String) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      runOnMain { setText(id, text) }
      return
    }
    val startNs = System.nanoTime()
    val view = nodes[id]
    nodeStates[id]?.cachedText = text
    val node = nodeStates[id]
    val descriptor = node?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (node != null) {
      descriptor?.applyProperty?.invoke(node, "text", text)
    }
    if (view is TextView) {
      runOnMain { applyTextValue(id, view, text) }
      yogaForNode(id).markDirty(id)
      markSurfaceDirtyForNode(id)
      val parentId = parents[id]
      if (parentId != null) {
        val parent = nodes[parentId]
        if (parent is TextView) {
          runOnMain { applyTextValue(parentId, parent, text) }
          yogaForNode(parentId).markDirty(parentId)
          markSurfaceDirtyForNode(parentId)
        }
      }
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
    if (parentState != null && parentState.type == "text") {
      parentState.textChildren.add(childId)
    }
    val surfaceId = if (parentId == 0) {
      activeSurfaceId
    } else {
      nodeSurfaces[parentId] ?: activeSurfaceId
    }
    val parent = if (parentId == 0) rootViewForSurface(surfaceId) else nodes[parentId]
    parents[childId] = parentId
    nodeSurfaces[childId] = surfaceId

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
      yogaForSurface(surfaceId).insertChild(parentId, childId, index)
      return
    }
    runOnMain {
      val targetIndex = index.coerceIn(0, group.childCount)
      group.addView(child, targetIndex)
    }
    yogaForSurface(surfaceId).insertChild(parentId, childId, index)
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

    nodeStates[parentId]?.textChildren?.remove(childId)
    cleanupNode(childId)
    parents.remove(childId)
    runOnMain { (child.parent as? ViewGroup)?.removeView(child) }
    yogaForNode(childId).removeChild(parentId, childId)
    markSurfaceDirtyForNode(childId)
    traceOp("removeChild", parentState?.type, startNs)
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
        JSBridge.invokeEvent(nodeId, event, json)
      }
    }
  }

  fun getLayoutEngine(): LayoutEngine = layoutEngine

  fun getRootView(): ZynthRootView = rootView

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
      runOnMain { applyBatchTypedPacked(ops, strings) }
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
          val keyIndex = ops[i++].toInt()
          val valueType = ops[i++].toInt()
          val payload = ops[i++]
          val key = strings.getOrNull(keyIndex) ?: ""
          val value = when (valueType) {
            1 -> payload.toString()
            2 -> strings.getOrNull(payload.toInt())
            3 -> if (payload != 0.0) "true" else "false"
            else -> "null"
          }
          setProp(nodeId, key, value)
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
      requestLayout()
    }
  }

  internal fun isBatching(): Boolean = batchDepth > 0

  internal fun markBatchNeedsLayout() {
    batchNeedsLayout = true
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
