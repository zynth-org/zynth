package com.zynth.kit.core

import android.util.Log
import android.view.View
import android.widget.TextView

private const val DEBUG_SCHEDULER = false

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
  val layoutStartNs = System.nanoTime()
  performLayoutInternal(dirty)
  tracePhase("layout", System.nanoTime() - layoutStartNs)
  val styleStartNs = System.nanoTime()
  applyStyleLayoutIfNeeded()
  tracePhase("style", System.nanoTime() - styleStartNs)
  val endNs = System.nanoTime()
  lastFrameMs = (endNs - startNs) / 1_000_000.0
  lastLayoutMs = lastFrameMs

  val overBudget = lastFrameMs > 14.0
  val nodeCount = surfaceYoga.values.sumOf { it.nodeCount() }
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
  val layoutEventStartNs = System.nanoTime()
  dispatchLayoutEvents()
  tracePhase("layoutEvents", System.nanoTime() - layoutEventStartNs)
  frameInProgress = false
  if (needsLayout && dirtySurfaces.isNotEmpty()) {
    frameCallbackPosted = true
    choreographer?.postFrameCallback(frameCallback)
  } else {
    frameCallbackPosted = false
  }
}

internal fun ZynthUIManager.performLayoutInternal(dirty: Set<Int>) {
  for (surfaceId in dirty) {
    val layout = surfaceYoga[surfaceId] ?: continue
    val root = surfaceRoots[surfaceId] ?: rootView
    val width = root.width.takeIf { it > 0 } ?: root.measuredWidth
    val height = root.height.takeIf { it > 0 } ?: root.measuredHeight
    syncSurfaceRootSize(surfaceId, root, width, height)
    layout.layout(width, height, nodes)
  }
}

internal fun ZynthUIManager.warmUpTextMeasurement() {
  val textView = TextView(rootView.context)
  textView.text = "Z"
  val spec = View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.AT_MOST)
  textView.measure(spec, spec)
}
