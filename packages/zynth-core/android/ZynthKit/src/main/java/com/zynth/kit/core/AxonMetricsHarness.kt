package com.zynth.kit.core

import android.os.SystemClock
import android.util.Log
import com.zynth.kit.BuildConfig

private const val AXON_METRICS_TAG = "ZynthAxonMetrics"

internal data class AxonMetricsHarnessConfig(
  val label: String,
  val delayMs: Long,
  val batchKind: String?,
  val surfaceId: Int?,
)

internal data class AxonMetricsPassSample(
  val startNs: Long,
  val computeNs: Long,
  val collectNs: Long,
  val applyNs: Long,
  val nodeCount: Int,
) {
  val totalNs: Long
    get() = computeNs + collectNs + applyNs

  val endNs: Long
    get() = startNs + totalNs
}

internal data class AxonMetricsHarnessSession(
  val config: AxonMetricsHarnessConfig,
  val surfaceId: Int,
  val batchKind: String?,
  var batchStartNs: Long,
  var batchCount: Int = 1,
  val passes: MutableList<AxonMetricsPassSample> = mutableListOf(),
  var completed: Boolean = false,
)

private data class MetricsSummary(
  val low: Double,
  val avg: Double,
  val high: Double,
)

internal fun ZynthUIManager.enableAxonMetricsHarnessInternal(
  label: String?,
  delayMs: Long,
  batchKind: String?,
  surfaceId: Int?,
) {
  val normalizedLabel = label?.trim().takeUnless { it.isNullOrEmpty() } ?: "Axon"
  val normalizedKind = batchKind?.trim().takeUnless { it.isNullOrEmpty() }
  synchronized(axonMetricsLock) {
    axonMetricsHarnessConfig = AxonMetricsHarnessConfig(
      label = normalizedLabel,
      delayMs = delayMs.coerceAtLeast(0L),
      batchKind = normalizedKind,
      surfaceId = surfaceId,
    )
    axonMetricsHarnessSession = null
  }
}

internal fun ZynthUIManager.disableAxonMetricsHarnessInternal() {
  synchronized(axonMetricsLock) {
    axonMetricsHarnessConfig = null
    axonMetricsHarnessSession = null
  }
}

internal fun ZynthUIManager.noteAxonMetricsBatchInternal(surfaceId: Int, kind: String?) {
  if (!BuildConfig.ZYNTH_LAYOUT_DEBUG_METRICS) return
  val nowNs = SystemClock.elapsedRealtimeNanos()
  val listenerSurfaceId: Int
  synchronized(axonMetricsLock) {
    val config = axonMetricsHarnessConfig ?: return
    if (config.surfaceId != null && config.surfaceId != surfaceId) return
    val normalizedKind = kind?.trim().takeUnless { it.isNullOrEmpty() }
    if (config.batchKind != null && config.batchKind != normalizedKind) return
    val existing = axonMetricsHarnessSession
    if (existing != null && !existing.completed && existing.surfaceId == surfaceId) {
      if (nowNs < existing.batchStartNs) {
        existing.batchStartNs = nowNs
      }
      existing.batchCount += 1
      return
    }
    axonMetricsHarnessSession = AxonMetricsHarnessSession(
      config = config,
      surfaceId = surfaceId,
      batchKind = normalizedKind,
      batchStartNs = nowNs,
    )
    listenerSurfaceId = surfaceId
  }
  addSurfaceFirstFrameListener(listenerSurfaceId) {
    completeAxonMetricsSessionInternal(listenerSurfaceId)
  }
}

internal fun ZynthUIManager.recordAxonMetricsPass(surfaceId: Int, sample: AxonMetricsPassSample) {
  synchronized(axonMetricsLock) {
    val session = axonMetricsHarnessSession ?: return
    if (session.completed || session.surfaceId != surfaceId) return
    session.passes.add(sample)
  }
}

internal fun ZynthUIManager.completeAxonMetricsSessionInternal(surfaceId: Int) {
  val completedAtNs = SystemClock.elapsedRealtimeNanos()
  val message: String
  val delayMs: Long
  synchronized(axonMetricsLock) {
    val session = axonMetricsHarnessSession ?: return
    if (session.completed || session.surfaceId != surfaceId) return
    session.completed = true
    delayMs = session.config.delayMs
    val passes = session.passes.toList()
    val totalMs = nanosToMs(completedAtNs - session.batchStartNs)
    val waitSummary = summarizeMs(passes.map { it.startNs - session.batchStartNs })
    val computeSummary = summarizeMs(passes.map { it.computeNs })
    val collectSummary = summarizeMs(passes.map { it.collectNs })
    val applySummary = summarizeMs(passes.map { it.applyNs })
    val passSummary = summarizeMs(passes.map { it.totalNs })
    val presentGapSummary = summarizeMs(
      passes.map { sample -> (completedAtNs - sample.endNs).coerceAtLeast(0L) }
    )
    val nodeSummary = summarizeValues(passes.map { it.nodeCount.toDouble() })
    val kind = session.batchKind ?: session.config.batchKind ?: "any"
    message = buildString {
      append(session.config.label)
      append(" surface=")
      append(session.surfaceId)
      append(" batch=")
      append(kind)
      append(" passes=")
      append(passes.size)
      append(" batches=")
      append(session.batchCount)
      append(" batch_to_first_frame_ms=")
      append(formatMs(totalMs))
      append(" wait_to_axon_ms=")
      append(formatSummary(waitSummary))
      append(" axon_compute_ms=")
      append(formatSummary(computeSummary))
      append(" frame_collect_ms=")
      append(formatSummary(collectSummary))
      append(" frame_apply_ms=")
      append(formatSummary(applySummary))
      append(" pass_total_ms=")
      append(formatSummary(passSummary))
      append(" present_gap_ms=")
      append(formatSummary(presentGapSummary))
      append(" nodes=")
      append(formatSummary(nodeSummary, digits = 0))
    }
    axonMetricsHarnessSession = null
  }
  rootView.postDelayed({
    if (BuildConfig.ZYNTH_LAYOUT_DEBUG_METRICS) {
      Log.d(AXON_METRICS_TAG, message)
    }
  }, delayMs)
}

private fun summarizeMs(valuesNs: List<Long>): MetricsSummary {
  return summarizeValues(valuesNs.map(::nanosToMs))
}

private fun summarizeValues(values: List<Double>): MetricsSummary {
  if (values.isEmpty()) return MetricsSummary(0.0, 0.0, 0.0)
  var low = Double.POSITIVE_INFINITY
  var high = Double.NEGATIVE_INFINITY
  var total = 0.0
  for (value in values) {
    if (value < low) low = value
    if (value > high) high = value
    total += value
  }
  return MetricsSummary(low, total / values.size, high)
}

private fun nanosToMs(valueNs: Long): Double = valueNs / 1_000_000.0

private fun formatSummary(summary: MetricsSummary, digits: Int = 2): String {
  return "${formatMs(summary.low, digits)}/${formatMs(summary.avg, digits)}/${formatMs(summary.high, digits)}"
}

private fun formatMs(value: Double, digits: Int = 2): String {
  return "%.${digits}f".format(value)
}
