package com.zynth.kit.core

import android.util.Log
import android.os.SystemClock
import android.view.View
import android.widget.TextView

private const val DEBUG_SCHEDULER = false
private const val ATOMIC_LAYOUT_APPLY_BUDGET_MS = 48.0
private const val ATOMIC_LAYOUT_PHASE_BUDGET_NS = 64_000_000L

internal fun ZynthUIManager.isLayoutDebugEnabled(): Boolean {
  return try {
    val virtualListDebug = System.getProperty("__ZYNTH_VLIST_DEBUG__")
    val nativeDebug = System.getProperty("__NATIVE_DEBUG__")
    virtualListDebug?.toBoolean()
      ?: nativeDebug?.toBoolean()
      ?: runCatching {
        val properties = Class.forName("android.os.SystemProperties")
        val getBoolean = properties.getMethod("getBoolean", String::class.java, Boolean::class.javaPrimitiveType)
        getBoolean.invoke(null, "debug.zynth.vlist", false) as? Boolean ?: false
      }.getOrDefault(false)
  } catch (error: Exception) {
    false
  }
}

internal fun ZynthUIManager.noteLayoutDebug(reason: String) {
  if (!isLayoutDebugEnabled()) return
  synchronized(layoutDebugCounts) {
    layoutDebugCounts[reason] = (layoutDebugCounts[reason] ?: 0) + 1
  }
}

internal fun ZynthUIManager.logLayoutDebugIfNeeded(reason: String) {
  if (!isLayoutDebugEnabled()) return
  val now = SystemClock.uptimeMillis()
  if (now - layoutDebugLastLogMs < 500L) return
  val counts = synchronized(layoutDebugCounts) {
    if (layoutDebugCounts.isEmpty()) {
      "none"
    } else {
      layoutDebugCounts.entries.joinToString(", ") { "${it.key}=${it.value}" }.also {
        layoutDebugCounts.clear()
      }
    }
  }
  Log.d(
    "ZynthLayoutDebug",
    "reason=$reason needsLayout=$needsLayout dirtySurfaces=${dirtySurfaces.size} layoutNodes=${layoutNodes.size} layoutPending=${layoutPending.size} layoutDirty=${layoutDirtyNodes.size} bufferedEvents=${layoutEventBuffer.size} counts=$counts"
  )
  layoutDebugLastLogMs = now
}

internal fun ZynthUIManager.setFrameProfilerInternal(
  profiler: ((frameMs: Double, layoutMs: Double, overBudget: Boolean, nodeCount: Int) -> Unit)?
) {
  frameProfiler = profiler
}

internal fun ZynthUIManager.requestLayoutInternal(reason: String = "unknown") {
  runOnMain {
    ensureChoreographerInternal()
    needsLayout = true
    noteLayoutDebug("requestLayout:$reason")
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
    noteLayoutDebug("frameSkipped")
    if (dirtySurfaces.isEmpty()) {
      atomicCommitPending = false
    }
    logLayoutDebugIfNeeded("frameSkipped")
    frameCallbackPosted = false
    return
  }
  noteLayoutDebug("frame")
  frameInProgress = true
  needsLayout = false

  val startNs = System.nanoTime()
  if (!didWarmup) {
    didWarmup = true
    warmUpTextMeasurement()
  }
  val dirty = dirtySurfaces.toSet()
  dirtySurfaces.clear()
  val forceAtomic = atomicCommitPending
  val nodeCount = nodes.size
  
  // C++ handles layout natively, so we just clear the dirty flags here.
  // We still track layout metrics for debugging if needed.
  val layoutStartNs = System.nanoTime()
  val layoutNs = System.nanoTime() - layoutStartNs
  tracePhase("layout", layoutNs)
  val layoutComplete = true
  if (!layoutComplete) {
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
  budgetMetrics.recordPass(lastFrameMs, overBudget)
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
  logLayoutDebugIfNeeded("frame")
  frameInProgress = false
  if (needsLayout && dirtySurfaces.isNotEmpty()) {
    noteLayoutDebug("frameReschedule")
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

  val measures = 0
  val changed = layoutDirtyNodes.size
  val nodeTotal = nodes.size
  perfMeasures += measures
  perfChanged += changed
  perfNodes = nodeTotal
  if (measures > perfMaxMeasureCount) perfMaxMeasureCount = measures
  if (changed > perfMaxChangedCount) perfMaxChangedCount = changed
  if (nodeTotal > perfMaxNodes) perfMaxNodes = nodeTotal
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

internal fun ZynthUIManager.warmUpTextMeasurement() {
  val textView = TextView(rootView.context)
  textView.text = "Z"
  val spec = View.MeasureSpec.makeMeasureSpec(1000, View.MeasureSpec.AT_MOST)
  textView.measure(spec, spec)
}
