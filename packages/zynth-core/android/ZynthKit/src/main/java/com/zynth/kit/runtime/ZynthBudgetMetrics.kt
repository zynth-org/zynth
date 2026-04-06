package com.zynth.kit.runtime

import android.os.SystemClock
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * Tracks and reports frame timing metrics (lowest, highest, average) 
 * for the Zynth UI manager's render passes.
 */
internal class ZynthBudgetMetrics {
  private val lock = Any()
  private val startTimeMs = SystemClock.elapsedRealtime()
  
  @Volatile var isEnabled: Boolean = false
    private set

  private var totalPasses: Long = 0
  private var lastPassMs: Double = 0.0
  private var shortestPassMs: Double = Double.MAX_VALUE
  private var longestPassMs: Double = 0.0
  private var budgetOverruns: Long = 0

  fun enable(enabled: Boolean) {
    isEnabled = enabled
  }

  /**
   * Records a frame pass duration. 
   * Frames within the first 1000ms are ignored to avoid initialization noise.
   */
  fun recordPass(durationMs: Double, overBudget: Boolean) {
    if (!isEnabled) return
    
    // 1 second warmup check as requested
    if (SystemClock.elapsedRealtime() - startTimeMs < 1000) return

    synchronized(lock) {
      totalPasses++
      lastPassMs = durationMs
      shortestPassMs = min(shortestPassMs, durationMs)
      longestPassMs = max(longestPassMs, durationMs)
      if (overBudget) {
        budgetOverruns++
      }
    }
  }

  fun makeSnapshot(): JSONObject {
    synchronized(lock) {
      return JSONObject()
        .put("totalPasses", totalPasses)
        .put("lastPassMs", lastPassMs)
        .put("shortestPassMs", if (totalPasses > 0) shortestPassMs else 0.0)
        .put("longestPassMs", longestPassMs)
        .put("budgetOverruns", budgetOverruns)
        .put("enabled", isEnabled)
    }
  }

  fun reset() {
    synchronized(lock) {
      totalPasses = 0
      lastPassMs = 0.0
      shortestPassMs = Double.MAX_VALUE
      longestPassMs = 0.0
      budgetOverruns = 0
    }
  }
}
