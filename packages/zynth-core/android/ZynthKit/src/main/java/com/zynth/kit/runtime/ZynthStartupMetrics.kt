package com.zynth.kit.runtime

import android.os.SystemClock
import org.json.JSONObject

internal class ZynthStartupMetrics {
  private val lock = Any()
  private val enabledFeatures = HashSet<String>()

  private var runtimeInitMs: Double? = null
  private var bundleReadStartMs: Double? = null
  private var bundleReadMs: Double? = null
  private var hermesEvalStartMs: Double? = null
  private var hermesEvalMs: Double? = null
  private var startRequestedMs: Double? = null
  private var firstFrameAtMs: Double? = null
  private var framesToFirstRender: Int = 0
  private var totalFrameMs: Double = 0.0
  private var totalLayoutMs: Double = 0.0

  private fun nowMs(): Double = SystemClock.elapsedRealtimeNanos() / 1_000_000.0

  fun markRuntimeCreated() {
    synchronized(lock) {
      if (runtimeInitMs == null) {
        runtimeInitMs = nowMs()
      }
    }
  }

  fun markBundleReadStart() {
    synchronized(lock) {
      bundleReadStartMs = nowMs()
    }
  }

  fun markBundleReadEnd() {
    synchronized(lock) {
      val end = nowMs()
      val start = bundleReadStartMs
      if (start != null) {
        bundleReadMs = kotlin.math.max(0.0, end - start)
      }
    }
  }

  fun markHermesEvalStart() {
    synchronized(lock) {
      hermesEvalStartMs = nowMs()
    }
  }

  fun markHermesEvalEnd() {
    synchronized(lock) {
      val end = nowMs()
      val start = hermesEvalStartMs
      if (start != null) {
        hermesEvalMs = kotlin.math.max(0.0, end - start)
      }
    }
  }

  fun markStartRequested() {
    synchronized(lock) {
      if (startRequestedMs == null) {
        startRequestedMs = nowMs()
      }
    }
  }

  fun markFirstFramePresented() {
    synchronized(lock) {
      if (firstFrameAtMs == null) {
        firstFrameAtMs = nowMs()
      }
    }
  }

  fun recordFrame(frameMs: Double, layoutMs: Double) {
    synchronized(lock) {
      if (firstFrameAtMs != null) {
        return
      }
      framesToFirstRender += 1
      totalFrameMs += kotlin.math.max(0.0, frameMs)
      totalLayoutMs += kotlin.math.max(0.0, layoutMs)
    }
  }

  fun enableFeatures(features: List<String>) {
    synchronized(lock) {
      for (feature in features) {
        if (feature == "startupTime") {
          enabledFeatures.add(feature)
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
    val startToFirstFrameMs = if (startRequestedMs != null && firstFrameAtMs != null) {
      kotlin.math.max(0.0, firstFrameAtMs!! - startRequestedMs!!)
    } else {
      null
    }
    val runtimeToFirstFrameMs = if (runtimeInitMs != null && firstFrameAtMs != null) {
      kotlin.math.max(0.0, firstFrameAtMs!! - runtimeInitMs!!)
    } else {
      null
    }

    return JSONObject()
      .put("enabled", enabledFeatures.contains("startupTime"))
      .put("ready", firstFrameAtMs != null)
      .putNullable("runtimeInitMs", runtimeInitMs)
      .putNullable("bundleReadMs", bundleReadMs)
      .putNullable("hermesEvalMs", hermesEvalMs)
      .putNullable("startToFirstFrameMs", startToFirstFrameMs)
      .putNullable("runtimeToFirstFrameMs", runtimeToFirstFrameMs)
      .put("framesToFirstRender", framesToFirstRender)
      .putNullable("avgFrameMsToFirstRender", avgFrameMs)
      .putNullable("avgLayoutMsToFirstRender", avgLayoutMs)
      .putNullable("firstFrameAtMs", firstFrameAtMs)
  }

  private fun JSONObject.putNullable(key: String, value: Any?): JSONObject {
    return if (value == null) {
      put(key, JSONObject.NULL)
    } else {
      put(key, value)
    }
  }
}
