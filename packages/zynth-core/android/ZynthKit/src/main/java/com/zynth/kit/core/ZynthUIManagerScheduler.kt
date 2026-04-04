package com.zynth.kit.core

import android.util.Log
import android.os.SystemClock
import com.zynth.kit.BuildConfig
import com.zynth.kit.runtime.JSBridge

private const val DEBUG_SCHEDULER = false
private const val ATOMIC_LAYOUT_APPLY_BUDGET_MS = 48.0
private const val ATOMIC_LAYOUT_PHASE_BUDGET_NS = 64_000_000L
private const val AXON_DEEP_METRICS_TAG = "ZynthAxonDeep"

internal fun ZynthUIManager.setFrameProfilerInternal(
  profiler: ((frameMs: Double, layoutMs: Double, overBudget: Boolean, nodeCount: Int) -> Unit)?
) {
  frameProfiler = profiler
}

internal fun ZynthUIManager.requestLayoutInternal() {
  runOnMain {
    ensureChoreographerInternal()
    needsLayout = true
    if (!frameCallbackPosted) {
      frameCallbackPosted = true
      choreographer?.postFrameCallback(frameCallback)
    }
  }
}

internal fun ZynthUIManager.ensureChoreographerInternal() {
  if (choreographer == null) {
    choreographer = android.view.Choreographer.getInstance()
  }
}

internal fun ZynthUIManager.handleFrame() {
  if (frameInProgress) return
  if (!needsLayout || dirtySurfaces.isEmpty()) {
    if (dirtySurfaces.isEmpty()) {
      atomicCommitPending = false
    }
    frameCallbackPosted = false
    return
  }
  frameInProgress = true
  needsLayout = false

  val startNs = System.nanoTime()
  if (!didWarmup) {
    didWarmup = true
    warmUpLayoutRuntime()
  }
  val dirty = dirtySurfaces.toSet()
  dirtySurfaces.clear()
  val nodeCount = nodeStates.size
  val forceAtomic = atomicCommitPending
  val layoutApplyBudgetMs =
    if (forceAtomic) ATOMIC_LAYOUT_APPLY_BUDGET_MS
    else computeAdaptiveLayoutApplyBudgetMs(dirty.size, nodeCount)
  val layoutPhaseBudgetNs =
    if (forceAtomic) ATOMIC_LAYOUT_PHASE_BUDGET_NS
    else computeAdaptiveLayoutPhaseBudgetNs(dirty.size, nodeCount)
  val layoutStartNs = System.nanoTime()
  val incomplete = performLayoutInternal(dirty, layoutApplyBudgetMs, layoutPhaseBudgetNs)
  val layoutNs = System.nanoTime() - layoutStartNs
  tracePhase("layout", layoutNs)
  val layoutComplete = incomplete.isEmpty()
  if (!layoutComplete) {
    dirtySurfaces.addAll(incomplete)
    needsLayout = true
  }
  var styleNs = 0L
  if (layoutComplete) {
    if (forceAtomic) {
      atomicCommitPending = false
    }
    val styleStartNs = System.nanoTime()
    applyStyleLayoutIfNeeded()
    styleNs = System.nanoTime() - styleStartNs
    tracePhase("style", styleNs)
    for (surfaceId in dirty) {
      dispatchSurfaceFirstFrameIfNeeded(surfaceId)
    }
  }
  val endNs = System.nanoTime()
  lastFrameMs = (endNs - startNs) / 1_000_000.0
  lastLayoutMs = lastFrameMs

  val overBudget = lastFrameMs > 14.0
  // Log.d(
  //   "ZynthUI",
  //   "frame summary %.2fms layout=%.2fms surfaces=%d nodes=%d overBudget=%b".format(
  //     lastFrameMs,
  //     lastLayoutMs,
  //     dirty.size,
  //     nodeCount,
  //     overBudget
  //   )
  // )
  if (overBudget && BuildConfig.ZYNTH_LAYOUT_DEBUG_LOGS) {
    budgetOverruns += 1
    Log.w(
      "ZynthUI",
      "frame over budget %.2fms (budget %.2fms, nodes %d, overruns %d)".format(
        lastFrameMs,
        14.0,
        nodeCount,
        budgetOverruns
      )
    )
  }
  frameProfiler?.invoke(lastFrameMs, lastLayoutMs, overBudget, nodeCount)
  var layoutEventNs = 0L
  if (layoutComplete) {
    val layoutEventStartNs = System.nanoTime()
    dispatchLayoutEvents()
    layoutEventNs = System.nanoTime() - layoutEventStartNs
    tracePhase("layoutEvents", layoutEventNs)
  }
  recordPerfSample(
    layoutNs / 1_000_000.0,
    styleNs / 1_000_000.0,
    layoutEventNs / 1_000_000.0,
    dirty.size
  )
  frameInProgress = false
  if (needsLayout && dirtySurfaces.isNotEmpty()) {
    frameCallbackPosted = true
    choreographer?.postFrameCallback(frameCallback)
  } else {
    frameCallbackPosted = false
  }
}

private fun ZynthUIManager.recordPerfSample(
  layoutMs: Double,
  styleMs: Double,
  layoutEventsMs: Double,
  surfaceCount: Int
) {
  perfFrameCount += 1
  perfLayoutMs += layoutMs
  perfStyleMs += styleMs
  perfLayoutEventsMs += layoutEventsMs
  perfSurfaces += surfaceCount
  if (layoutMs > perfMaxLayoutMs) perfMaxLayoutMs = layoutMs
  if (styleMs > perfMaxStyleMs) perfMaxStyleMs = styleMs
  if (layoutEventsMs > perfMaxLayoutEventsMs) perfMaxLayoutEventsMs = layoutEventsMs

  val measures: Int
  val changed: Int
  val nodes: Int
  nodes = nodeStates.size
  measures = 0
  changed = 0
  perfMeasures += measures
  perfChanged += changed
  perfNodes = nodes
  if (measures > perfMaxMeasureCount) perfMaxMeasureCount = measures
  if (changed > perfMaxChangedCount) perfMaxChangedCount = changed
  if (nodes > perfMaxNodes) perfMaxNodes = nodes
  if (surfaceCount > perfMaxSurfaces) perfMaxSurfaces = surfaceCount

  val nowMs = SystemClock.uptimeMillis()
  val shouldLog = nowMs - perfLastLogMs >= 1000L
  if (!shouldLog) return
  val frames = perfFrameCount.coerceAtLeast(1)
  /*
  Log.d(
    "ZynthPerf",
    "frames=%d layout=%.2fms(max=%.2f) style=%.2fms(max=%.2f) events=%.2fms(max=%.2f) measures=%d(max=%d) changed=%d(max=%d) nodes=%d(max=%d) surfaces=%d(max=%d)".format(
      frames,
      perfLayoutMs / frames,
      perfMaxLayoutMs,
      perfStyleMs / frames,
      perfMaxStyleMs,
      perfLayoutEventsMs / frames,
      perfMaxLayoutEventsMs,
      perfMeasures,
      perfMaxMeasureCount,
      perfChanged,
      perfMaxChangedCount,
      perfNodes,
      perfMaxNodes,
      perfSurfaces
      ,
      perfMaxSurfaces
    )
  )
  */
  perfFrameCount = 0
  perfLayoutMs = 0.0
  perfStyleMs = 0.0
  perfLayoutEventsMs = 0.0
  perfMeasures = 0
  perfChanged = 0
  perfSurfaces = 0
  perfMaxLayoutMs = 0.0
  perfMaxStyleMs = 0.0
  perfMaxLayoutEventsMs = 0.0
  perfMaxMeasureCount = 0
  perfMaxChangedCount = 0
  perfMaxNodes = 0
  perfMaxSurfaces = 0
  perfLastLogMs = nowMs
}

internal fun ZynthUIManager.performLayoutInternal(dirty: Set<Int>): Set<Int> {
  return performLayoutInternal(dirty, layoutApplyBudgetMs, 24_000_000L)
}

private fun ZynthUIManager.computeAdaptiveLayoutApplyBudgetMs(
  dirtySurfaceCount: Int,
  nodeCount: Int
): Double {
  var budget = layoutApplyBudgetMs
  if (lastFrameMs > 14.0 || budgetOverruns > 0) {
    budget -= 1.0
  }
  if (dirtySurfaceCount >= 2) {
    budget += 0.75
  }
  if (nodeCount >= 1500) {
    budget += 1.0
  }
  return budget.coerceIn(layoutApplyBudgetMinMs, layoutApplyBudgetMaxMs)
}

private fun ZynthUIManager.computeAdaptiveLayoutPhaseBudgetNs(
  dirtySurfaceCount: Int,
  nodeCount: Int
): Long {
  var budgetNs = 24_000_000L
  if (lastFrameMs > 14.0) {
    budgetNs -= 2_000_000L
  }
  if (dirtySurfaceCount >= 2) {
    budgetNs += 2_000_000L
  }
  if (nodeCount >= 1500) {
    budgetNs += 2_000_000L
  }
  return budgetNs.coerceIn(layoutPhaseBudgetMinNs, layoutPhaseBudgetMaxNs)
}

internal fun ZynthUIManager.performLayoutInternal(
  dirty: Set<Int>,
  perSurfaceApplyBudgetMs: Double,
  totalBudgetNs: Long
): Set<Int> {
  val incomplete = HashSet<Int>()
  val startNs = System.nanoTime()

  for (surfaceId in dirty) {
    if (System.nanoTime() - startNs > totalBudgetNs) {
      incomplete.add(surfaceId)
      continue
    }

    val root = surfaceRoots[surfaceId] ?: rootView
    var width = root.width.takeIf { it > 0 } ?: root.measuredWidth
    var height = root.height.takeIf { it > 0 } ?: root.measuredHeight
    if ((width <= 0 || height <= 0) && root !== rootView) {
      width = rootView.width.takeIf { it > 0 } ?: rootView.measuredWidth
      height = rootView.height.takeIf { it > 0 } ?: rootView.measuredHeight
    }
    syncSurfaceRootSize(surfaceId, root, width, height)
    val complete = performAxonLayoutInternal(surfaceId, width, height)
    if (!complete) {
      incomplete.add(surfaceId)
    }
  }
  return incomplete
}

private fun ZynthUIManager.performAxonLayoutInternal(surfaceId: Int, width: Int, height: Int): Boolean {
  if (width <= 0 || height <= 0 || runtimePtr == 0L) return false
  val passStartNs = SystemClock.elapsedRealtimeNanos()
  val computeStartNs = passStartNs
  if (!JSBridge.axonComputeLayout(runtimePtr, surfaceId, width.toFloat(), height.toFloat())) {
    return false
  }
  val computeNs = SystemClock.elapsedRealtimeNanos() - computeStartNs
  logAxonDeepMetrics(surfaceId)

  val ids = collectSurfaceNodeIds(surfaceId)
  if (ids.isEmpty()) {
    recordAxonMetricsPass(
      surfaceId,
      AxonMetricsPassSample(
        startNs = passStartNs,
        computeNs = computeNs,
        collectNs = 0L,
        applyNs = 0L,
        nodeCount = 0,
      )
    )
    return true
  }
  val nodeIds = ids.toIntArray()
  val frames = FloatArray(nodeIds.size * 4)
  val collectStartNs = SystemClock.elapsedRealtimeNanos()
  if (!JSBridge.axonCollectFrames(runtimePtr, nodeIds, frames)) {
    return false
  }
  val collectNs = SystemClock.elapsedRealtimeNanos() - collectStartNs

  val applyStartNs = SystemClock.elapsedRealtimeNanos()
  for (index in nodeIds.indices) {
    val id = nodeIds[index]
    val view = nodes[id] ?: continue
    val base = index * 4
    val left = frames[base].toInt()
    val top = frames[base + 1].toInt()
    val widthPx = frames[base + 2].toInt()
    val heightPx = frames[base + 3].toInt()
    val right = left + widthPx
    val bottom = top + heightPx
    val changed =
      view.left != left || view.top != top || view.right != right || view.bottom != bottom
    if (view is ZynthLayoutView) {
      view.updateLayoutBounds(widthPx, heightPx)
    }
    val widthSpec = android.view.View.MeasureSpec.makeMeasureSpec(widthPx, android.view.View.MeasureSpec.EXACTLY)
    val heightSpec = android.view.View.MeasureSpec.makeMeasureSpec(heightPx, android.view.View.MeasureSpec.EXACTLY)
    if (
      view.measuredWidth != widthPx ||
      view.measuredHeight != heightPx ||
      view.isLayoutRequested
    ) {
      view.measure(widthSpec, heightSpec)
    }
    if (changed) {
      view.layout(left, top, right, bottom)
    }
    onFrameApplied(id, left, top, right, bottom, changed)
  }
  val applyNs = SystemClock.elapsedRealtimeNanos() - applyStartNs
  recordAxonMetricsPass(
    surfaceId,
    AxonMetricsPassSample(
      startNs = passStartNs,
      computeNs = computeNs,
      collectNs = collectNs,
      applyNs = applyNs,
      nodeCount = nodeIds.size,
    )
  )

  return true
}

private fun ZynthUIManager.logAxonDeepMetrics(surfaceId: Int) {
  if (!BuildConfig.ZYNTH_LAYOUT_DEBUG_METRICS) return
  val raw = JSBridge.axonGetLastComputeStats(runtimePtr) ?: return
  if (raw.size < 86) return
  fun nanosToMs(index: Int): Double = raw[index] / 1_000_000.0
  fun bitsToFloat(bits: Long): Float = Float.fromBits(bits.toInt())
  fun formatOptionalFloat(bits: Long): String {
    return if (bits == 4294967295L) "-" else "%.1f".format(bitsToFloat(bits))
  }
  fun formatConstraintSample(startIndex: Int): String? {
    val awBits = raw[startIndex]
    val ahBits = raw[startIndex + 1]
    val kwBits = raw[startIndex + 2]
    val khBits = raw[startIndex + 3]
    val flags = raw[startIndex + 4].toInt()
    if (awBits == 0L && ahBits == 0L && kwBits == 0L && khBits == 0L && flags == 0) {
      return null
    }
    val widthDefinite = (flags and 1) != 0
    val heightDefinite = (flags and (1 shl 1)) != 0
    val rtl = (flags and (1 shl 2)) != 0
    return "aw=${"%.1f".format(bitsToFloat(awBits))} ah=${"%.1f".format(bitsToFloat(ahBits))} " +
      "kw=${formatOptionalFloat(kwBits)} kh=${formatOptionalFloat(khBits)} " +
      "wd=$widthDefinite hd=$heightDefinite rtl=$rtl"
  }
  fun sanitizeTextPreview(text: String): String {
    return text
      .replace("\n", "\\n")
      .replace("\r", "\\r")
      .replace("\"", "'")
      .take(32)
  }
  fun describeNode(nodeId: Long): String {
    if (nodeId < 0 || nodeId > Int.MAX_VALUE) return "id=$nodeId"
    val id = nodeId.toInt()
    val node = nodeStates[id]
    val view = nodes[id]
    if (node == null && view == null) return "id=$id:missing"
    val parentId = parents[id]?.toString() ?: "root"
    val surface = nodeSurfaces[id]?.toString() ?: "?"
    val type = node?.type ?: "?"
    val viewName = view?.javaClass?.simpleName ?: "?"
    val childCount = children[id]?.size ?: 0
    val textPreview = node?.cachedText?.takeIf { it.isNotEmpty() }
      ?: (view as? android.widget.TextView)?.text?.toString()?.takeIf { it.isNotEmpty() }
    val textPart = textPreview?.let { " text=\"${sanitizeTextPreview(it)}\"" } ?: ""
    return "id=$id type=$type view=$viewName parent=$parentId surface=$surface children=$childCount$textPart"
  }
  fun formatTopNodes(startIndex: Int): String {
    val pairs = ArrayList<String>(3)
    var cursor = startIndex
    repeat(3) {
      val nodeId = raw[cursor]
      val count = raw[cursor + 1]
      val uniqueConstraints = raw[cursor + 2]
      if (nodeId != 4294967295L && count > 0L) {
        val samples = ArrayList<String>(3)
        var sampleCursor = cursor + 3
        repeat(3) {
          formatConstraintSample(sampleCursor)?.let { samples += it }
          sampleCursor += 5
        }
        val samplesPart = if (samples.isEmpty()) "-" else samples.joinToString(" ; ")
        pairs += "${describeNode(nodeId)} count=$count unique_constraints=$uniqueConstraints samples=[$samplesPart]"
      }
      cursor += 18
    }
    return if (pairs.isEmpty()) "-" else pairs.joinToString(" | ")
  }
  fun formatTopMinNodes(startIndex: Int): String {
    val pairs = ArrayList<String>(3)
    var cursor = startIndex
    repeat(3) {
      val nodeId = raw[cursor]
      val count = raw[cursor + 1]
      if (nodeId != 4294967295L && count > 0L) {
        pairs += "${describeNode(nodeId)} count=$count"
      }
      cursor += 2
    }
    return if (pairs.isEmpty()) "-" else pairs.joinToString(" | ")
  }
  if (BuildConfig.ZYNTH_LAYOUT_DEBUG_METRICS) {
    Log.d(
      AXON_DEEP_METRICS_TAG,
      "surface=$surfaceId total_ms=${"%.2f".format(nanosToMs(0))} nodes=${raw[1]} " +
        "layout_node_calls=${raw[2]} layout_cache_hits=${raw[3]} layout_cache_misses=${raw[4]} " +
        "min_cache_hits=${raw[5]} min_cache_misses=${raw[6]} " +
        "intrinsic_calls=${raw[7]} text_intrinsic_calls=${raw[8]} host_intrinsic_calls=${raw[9]} " +
        "prepare_calls=${raw[10]} prepare_hits=${raw[11]} prepare_misses=${raw[12]} prepare_ms=${"%.2f".format(nanosToMs(13))} " +
        "text_layout_calls=${raw[14]} text_layout_ms=${"%.2f".format(nanosToMs(15))} " +
        "text_min_calls=${raw[16]} text_min_ms=${"%.2f".format(nanosToMs(17))} " +
        "setup_hits=${raw[18]} setup_misses=${raw[19]} " +
        "segment_hits=${raw[20]} segment_misses=${raw[21]} " +
        "host_measure_calls=${raw[22]} host_measure_ms=${"%.2f".format(nanosToMs(23))} " +
        "prepared_segments=${raw[24]} prepared_bytes=${raw[25]} " +
        "top_layout_nodes=${formatTopNodes(26)} top_min_nodes=${formatTopMinNodes(80)}"
    )
  }
}

private fun ZynthUIManager.collectSurfaceNodeIds(surfaceId: Int): List<Int> {
  val roots = children[surfaceId] ?: return emptyList()
  val ordered = ArrayList<Int>(roots.size.coerceAtLeast(16))
  val stack = ArrayDeque<Int>()
  for (index in roots.indices.reversed()) {
    stack.addLast(roots[index])
  }
  while (stack.isNotEmpty()) {
    val id = stack.removeLast()
    if (nodeSurfaces[id] != surfaceId) {
      continue
    }
    val parentId = parents[id]
    if (parentId != null) {
      val parentNode = nodeStates[parentId]
      val node = nodeStates[id]
      if (parentNode?.type == "text" && node?.type == "text") {
        continue
      }
    }
    if (!nodes.containsKey(id)) {
      continue
    }
    ordered.add(id)
    val childIds = children[id] ?: continue
    for (index in childIds.indices.reversed()) {
      stack.addLast(childIds[index])
    }
  }
  return ordered
}

internal fun ZynthUIManager.warmUpLayoutRuntime() {
  if (usesAxonLayoutRuntime()) {
    refreshAxonEnvironment()
    prewarmAxonTypography()
    return
  }

  val textView = android.widget.TextView(rootView.context)
  textView.text = "Z"
  val spec = android.view.View.MeasureSpec.makeMeasureSpec(1000, android.view.View.MeasureSpec.AT_MOST)
  textView.measure(spec, spec)
}
