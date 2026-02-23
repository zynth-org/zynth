package com.zynth.kit.runtime

import android.os.Looper
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject

internal class ZynthStartupMetrics {
  private val lock = Any()
  private val enabledFeatures = HashSet<String>()
  @Volatile private var startupTimeEnabled: Boolean = false

  private var runtimeConstructStartMs: Double? = null
  private var runtimeConstructEndMs: Double? = null
  private var runtimeInitMs: Double? = null
  private var moduleInitStartMs: Double? = null
  private var moduleInitEndMs: Double? = null
  private var jsRuntimeSetupStartMs: Double? = null
  private var jsRuntimeSetupEndMs: Double? = null
  private var bundleReadStartMs: Double? = null
  private var bundleReadMs: Double? = null
  private var hermesEvalStartMs: Double? = null
  private var hermesEvalMs: Double? = null
  private var startRequestedMs: Double? = null
  private var firstCommitMs: Double? = null
  private var firstFrameAtMs: Double? = null
  private var firstInteractiveMs: Double? = null
  private var framesToFirstRender: Int = 0
  private var totalFrameMs: Double = 0.0
  private var totalLayoutMs: Double = 0.0

  private val phaseThreads = LinkedHashMap<String, String>()
  private val moduleInitStarts = HashMap<String, Double>()
  private val moduleInitTimings = ArrayList<ModuleInitTiming>()

  private var syncWaitCount: Int = 0
  private var syncWaitMainThreadCount: Int = 0
  private var syncWaitTotalMs: Double = 0.0
  private var syncWaitMainThreadTotalMs: Double = 0.0
  private var syncWaitMaxMs: Double = 0.0

  data class ModuleInitTiming(
    val name: String,
    val startMs: Double,
    val endMs: Double,
    val durationMs: Double,
    val thread: String,
  )

  companion object {
    private val processStartMs: Double = SystemClock.elapsedRealtimeNanos() / 1_000_000.0
  }

  fun nowMs(): Double = SystemClock.elapsedRealtimeNanos() / 1_000_000.0

  fun isStartupTimeEnabled(): Boolean = startupTimeEnabled

  private fun currentThreadLabel(): String {
    val threadName = Thread.currentThread().name
    val prefix = if (Looper.myLooper() == Looper.getMainLooper()) "main" else "background"
    return "$prefix:$threadName"
  }

  private fun markPhaseThread(phase: String) {
    if (!phaseThreads.containsKey(phase)) {
      phaseThreads[phase] = currentThreadLabel()
    }
  }

  fun markRuntimeConstructStart() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (runtimeConstructStartMs == null) {
        runtimeConstructStartMs = nowMs()
      }
      markPhaseThread("runtimeConstructStart")
    }
  }

  fun markRuntimeConstructEnd() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (runtimeConstructEndMs == null) {
        runtimeConstructEndMs = nowMs()
      }
      markPhaseThread("runtimeConstructEnd")
    }
  }

  fun markRuntimeCreated() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (runtimeInitMs == null) {
        runtimeInitMs = nowMs()
      }
      markPhaseThread("runtimeCreated")
    }
  }

  fun markModuleInitStart() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (moduleInitStartMs == null) {
        moduleInitStartMs = nowMs()
      }
      markPhaseThread("moduleInitStart")
    }
  }

  fun markModuleInitEnd() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (moduleInitEndMs == null) {
        moduleInitEndMs = nowMs()
      }
      markPhaseThread("moduleInitEnd")
    }
  }

  fun markModuleInitializeStart(moduleName: String) {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (moduleName.isEmpty()) return
      moduleInitStarts[moduleName] = nowMs()
      markPhaseThread("moduleInit:$moduleName:start")
    }
  }

  fun markModuleInitializeEnd(moduleName: String) {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (moduleName.isEmpty()) return
      val end = nowMs()
      val start = moduleInitStarts.remove(moduleName) ?: return
      moduleInitTimings.add(
        ModuleInitTiming(
          name = moduleName,
          startMs = start,
          endMs = end,
          durationMs = kotlin.math.max(0.0, end - start),
          thread = currentThreadLabel(),
        )
      )
      markPhaseThread("moduleInit:$moduleName:end")
    }
  }

  fun markJsRuntimeSetupStart() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (jsRuntimeSetupStartMs == null) {
        jsRuntimeSetupStartMs = nowMs()
      }
      markPhaseThread("jsRuntimeSetupStart")
    }
  }

  fun markJsRuntimeSetupEnd() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (jsRuntimeSetupEndMs == null) {
        jsRuntimeSetupEndMs = nowMs()
      }
      markPhaseThread("jsRuntimeSetupEnd")
    }
  }

  fun markBundleReadStart() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      bundleReadStartMs = nowMs()
      markPhaseThread("bundleReadStart")
    }
  }

  fun markBundleReadEnd() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      val end = nowMs()
      val start = bundleReadStartMs
      if (start != null) {
        bundleReadMs = kotlin.math.max(0.0, end - start)
      }
      markPhaseThread("bundleReadEnd")
    }
  }

  fun markHermesEvalStart() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      hermesEvalStartMs = nowMs()
      markPhaseThread("hermesEvalStart")
    }
  }

  fun markHermesEvalEnd() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      val end = nowMs()
      val start = hermesEvalStartMs
      if (start != null) {
        hermesEvalMs = kotlin.math.max(0.0, end - start)
      }
      markPhaseThread("hermesEvalEnd")
    }
  }

  fun markStartRequested() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (startRequestedMs == null) {
        startRequestedMs = nowMs()
      }
      markPhaseThread("startRequested")
    }
  }

  fun markFirstCommit() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (firstCommitMs == null) {
        firstCommitMs = nowMs()
      }
      markPhaseThread("firstCommit")
    }
  }

  fun markFirstFramePresented() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (firstFrameAtMs == null) {
        firstFrameAtMs = nowMs()
      }
      markPhaseThread("firstFrame")
    }
  }

  fun markFirstInteractive() {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (firstInteractiveMs == null) {
        firstInteractiveMs = nowMs()
      }
      markPhaseThread("firstInteractive")
    }
  }

  fun recordFrame(frameMs: Double, layoutMs: Double) {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      if (firstFrameAtMs != null) {
        return
      }
      framesToFirstRender += 1
      totalFrameMs += kotlin.math.max(0.0, frameMs)
      totalLayoutMs += kotlin.math.max(0.0, layoutMs)
    }
  }

  fun recordRunOnJSSyncWait(waitMs: Double, callerOnMainThread: Boolean) {
    if (!startupTimeEnabled) return
    synchronized(lock) {
      if (!startupTimeEnabled) return
      val safeWait = kotlin.math.max(0.0, waitMs)
      syncWaitCount += 1
      syncWaitTotalMs += safeWait
      if (safeWait > syncWaitMaxMs) {
        syncWaitMaxMs = safeWait
      }
      if (callerOnMainThread) {
        syncWaitMainThreadCount += 1
        syncWaitMainThreadTotalMs += safeWait
      }
      markPhaseThread("runOnJSSyncWait")
    }
  }

  fun enableFeatures(features: List<String>) {
    synchronized(lock) {
      for (feature in features) {
        if (feature == "startupTime") {
          enabledFeatures.add(feature)
          startupTimeEnabled = true
        }
      }
    }
  }

  fun makeSnapshot(): JSONObject {
    val result = JSONObject()
    synchronized(lock) {
      if (enabledFeatures.contains("startupTime")) {
        result.put("startupTime", makeStartupSnapshotLocked())
      }
    }
    return result
  }

  fun makeStartupSnapshot(): JSONObject {
    synchronized(lock) {
      return makeStartupSnapshotLocked()
    }
  }

  private fun makeStartupSnapshotLocked(): JSONObject {
    val avgFrameMs = if (framesToFirstRender > 0) totalFrameMs / framesToFirstRender else null
    val avgLayoutMs = if (framesToFirstRender > 0) totalLayoutMs / framesToFirstRender else null

    val runtimeConstructMs = duration(runtimeConstructStartMs, runtimeConstructEndMs)
    val moduleInitMs = duration(moduleInitStartMs, moduleInitEndMs)
    val jsRuntimeSetupMs = duration(jsRuntimeSetupStartMs, jsRuntimeSetupEndMs)
    val startToFirstFrameMs = duration(startRequestedMs, firstFrameAtMs)
    val runtimeToFirstFrameMs = duration(runtimeInitMs, firstFrameAtMs)
    val firstCommitToFirstFrameMs = duration(firstCommitMs, firstFrameAtMs)
    val firstFrameToFirstInteractiveMs = duration(firstFrameAtMs, firstInteractiveMs)
    val startToFirstInteractiveMs = duration(startRequestedMs, firstInteractiveMs)

    return JSONObject()
      .put("enabled", enabledFeatures.contains("startupTime"))
      .put("ready", firstFrameAtMs != null)
      .putNullable("processStartMs", processStartMs)
      .putNullable("runtimeConstructStartMs", runtimeConstructStartMs)
      .putNullable("runtimeConstructEndMs", runtimeConstructEndMs)
      .putNullable("runtimeConstructMs", runtimeConstructMs)
      .putNullable("runtimeInitMs", runtimeInitMs)
      .putNullable("moduleInitStartMs", moduleInitStartMs)
      .putNullable("moduleInitEndMs", moduleInitEndMs)
      .putNullable("moduleInitMs", moduleInitMs)
      .putNullable("jsRuntimeSetupStartMs", jsRuntimeSetupStartMs)
      .putNullable("jsRuntimeSetupEndMs", jsRuntimeSetupEndMs)
      .putNullable("jsRuntimeSetupMs", jsRuntimeSetupMs)
      .putNullable("bundleReadMs", bundleReadMs)
      .putNullable("hermesEvalMs", hermesEvalMs)
      .putNullable("startAppCallMs", startRequestedMs)
      .putNullable("firstCommitMs", firstCommitMs)
      .putNullable("firstFrameAtMs", firstFrameAtMs)
      .putNullable("firstInteractiveMs", firstInteractiveMs)
      .putNullable("startToFirstFrameMs", startToFirstFrameMs)
      .putNullable("runtimeToFirstFrameMs", runtimeToFirstFrameMs)
      .putNullable("firstCommitToFirstFrameMs", firstCommitToFirstFrameMs)
      .putNullable("firstFrameToFirstInteractiveMs", firstFrameToFirstInteractiveMs)
      .putNullable("startToFirstInteractiveMs", startToFirstInteractiveMs)
      .put("framesToFirstRender", framesToFirstRender)
      .putNullable("avgFrameMsToFirstRender", avgFrameMs)
      .putNullable("avgLayoutMsToFirstRender", avgLayoutMs)
      .put("threadByPhase", makeThreadByPhaseObject())
      .put("syncWait", makeSyncWaitObject())
      .put("moduleInitBreakdown", makeModuleBreakdownArray())
  }

  private fun duration(startMs: Double?, endMs: Double?): Double? {
    if (startMs == null || endMs == null) return null
    return kotlin.math.max(0.0, endMs - startMs)
  }

  private fun makeThreadByPhaseObject(): JSONObject {
    val result = JSONObject()
    val entries = phaseThreads.entries
    for (entry in entries) {
      result.put(entry.key, entry.value)
    }
    return result
  }

  private fun makeSyncWaitObject(): JSONObject {
    return JSONObject()
      .put("count", syncWaitCount)
      .put("totalMs", syncWaitTotalMs)
      .put("maxMs", syncWaitMaxMs)
      .put("mainThreadCount", syncWaitMainThreadCount)
      .put("mainThreadTotalMs", syncWaitMainThreadTotalMs)
  }

  private fun makeModuleBreakdownArray(): JSONArray {
    val sorted = moduleInitTimings.sortedByDescending { it.durationMs }
    val result = JSONArray()
    for (timing in sorted) {
      result.put(
        JSONObject()
          .put("name", timing.name)
          .put("startMs", timing.startMs)
          .put("endMs", timing.endMs)
          .put("durationMs", timing.durationMs)
          .put("thread", timing.thread)
      )
    }
    return result
  }

  private fun JSONObject.putNullable(key: String, value: Any?): JSONObject {
    return if (value == null) {
      put(key, JSONObject.NULL)
    } else {
      put(key, value)
    }
  }
}
