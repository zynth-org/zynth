package com.zynth.kit.core

import android.util.Log
import android.os.SystemClock
import android.view.View
import android.widget.TextView

private const val DEBUG_SCHEDULER = false
private const val ATOMIC_LAYOUT_APPLY_BUDGET_MS = 48.0
private const val ATOMIC_LAYOUT_PHASE_BUDGET_NS = 64_000_000L

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
    warmUpTextMeasurement()
  }
  val dirty = dirtySurfaces.toSet()
  dirtySurfaces.clear()
  val nodeCount = surfaceYoga.values.sumOf { it.nodeCount() }
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
  if (overBudget) {
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

  var measures = 0
  var changed = 0
  var nodes = 0
  for (layout in surfaceYoga.values) {
    nodes += layout.nodeCount()
    measures += layout.lastLayoutMeasureCount()
    changed += layout.lastLayoutChangedCount()
  }
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

    val layout = surfaceYoga[surfaceId] ?: continue
    val root = surfaceRoots[surfaceId] ?: rootView
    var width = root.width.takeIf { it > 0 } ?: root.measuredWidth
    var height = root.height.takeIf { it > 0 } ?: root.measuredHeight
    if ((width <= 0 || height <= 0) && root !== rootView) {
      width = rootView.width.takeIf { it > 0 } ?: rootView.measuredWidth
      height = rootView.height.takeIf { it > 0 } ?: rootView.measuredHeight
    }
    syncSurfaceRootSize(surfaceId, root, width, height)
    val complete = layout.layout(width, height, nodes, perSurfaceApplyBudgetMs)
    if (!complete) {
      incomplete.add(surfaceId)
    }
  }
  return incomplete
}

internal fun ZynthUIManager.warmUpTextMeasurement() {
  val textView = TextView(rootView.context)
  textView.text = "Z"
  val spec = View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.AT_MOST)
  textView.measure(spec, spec)
}
