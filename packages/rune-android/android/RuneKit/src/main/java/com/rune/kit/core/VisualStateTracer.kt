package com.rune.kit.core

import android.os.SystemClock
import android.util.Log
import java.util.Locale

/**
 * VisualStateTracer emits structured logcat entries that map out the order and timing of UI
 * mutations. It is designed for diagnosing visual flashes/FOUC issues by showing when nodes are
 * created, styled, inserted, and when layout flushes execute.
 */
internal class VisualStateTracer(
  private val surfaceId: Int,
  private val tag: String = "RuneVisual",
) {
  private val startTimeMs = SystemClock.elapsedRealtime()

  fun trace(event: String, details: String? = null) {
    if (!isEnabled()) return
    val delta = SystemClock.elapsedRealtime() - startTimeMs
    val builder = StringBuilder()
    builder
      .append("[surface=")
      .append(surfaceId)
      .append(" +")
      .append(delta)
      .append("ms] ")
      .append(event)
    if (!details.isNullOrBlank()) {
      builder.append(" -> ").append(details)
    }
    Log.d(tag, builder.toString())
  }

  fun formatValue(value: Any?): String {
    val raw = when (value) {
      null -> "null"
      is String -> value
      else -> value.toString()
    }.replace("\n", " ")
    return truncate(raw)
  }

  fun formatJson(json: String?): String {
    val raw = json?.takeIf { it.isNotBlank() } ?: "null"
    return truncate(raw.replace("\n", " "))
  }

  private fun truncate(value: String, limit: Int = 160): String {
    return if (value.length <= limit) value else value.take(limit) + "..."
  }

  companion object {
    private val yesValues = setOf("1", "true", "on", "enable", "enabled")
    private val noValues = setOf("0", "false", "off", "disable", "disabled")
    @Volatile private var enabledOverride: Boolean? = null

    private fun readSystemFlag(): Boolean? {
      val prop = runCatching { System.getProperty("rune.visual.tracer") }
        .getOrNull()
        ?.trim()
        ?.lowercase(Locale.US)
      if (!prop.isNullOrEmpty()) {
        if (prop in yesValues) return true
        if (prop in noValues) return false
      }
      val env = System.getenv("RUNE_VISUAL_TRACER")
        ?.trim()
        ?.lowercase(Locale.US)
      if (!env.isNullOrEmpty()) {
        if (env in yesValues) return true
        if (env in noValues) return false
      }
      return null
    }

    fun setEnabledOverride(enabled: Boolean) {
      enabledOverride = enabled
    }

    fun isEnabled(): Boolean {
      val override = enabledOverride
      if (override != null) return override
      val fromSystem = readSystemFlag()
      if (fromSystem != null) return fromSystem
      return false // disable by default to avoid log overhead
    }
  }
}
