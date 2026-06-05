package com.zynth.kit.runtime

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Choreographer
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.View.OnLayoutChangeListener
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.WindowInsetsCompat
import com.zynth.kit.core.ZynthRootView
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt

internal object ZynthNativePerformanceOverlay {
  private const val PERF_RAM_VALUE_TAG = 94_001
  private const val PERF_VIEWS_VALUE_TAG = 94_002
  private const val PERF_UI_VALUE_TAG = 94_003
  private const val PERF_JS_VALUE_TAG = 94_004
  private const val PERF_CHEVRON_TAG = 94_005
  private const val PERF_DETAILS_TAG = 94_006
  private const val PERF_LAST_PASS_VALUE_TAG = 94_007
  private const val PERF_SHORTEST_PASS_VALUE_TAG = 94_008
  private const val PERF_LONGEST_PASS_VALUE_TAG = 94_009
  private const val PERF_OVERRUNS_VALUE_TAG = 94_010
  private const val PERF_PASSES_VALUE_TAG = 94_011
  private const val PERF_LAST_YOGA_VALUE_TAG = 94_012
  private const val RUNTIME_FONT_ASSET = "fonts/ZynthRuntime.ttf"
  private const val CHEVRON_GLYPH = "\uEA07"
  private const val OVERLAY_WIDTH_DP = 330
  private const val OVERLAY_TAP_HEIGHT_DP = 44
  private const val FPS_WARN_OFFSET = 6
  private const val FPS_RECOVER_OFFSET = 3
  private const val FPS_WARN_SAMPLES = 3
  private const val FPS_RECOVER_SAMPLES = 2
  private const val UI_FPS_DISPLAY_DEADBAND = 1
  private const val JS_FPS_DISPLAY_DEADBAND = 1
  private const val JS_RESPONSE_BUDGET_GRACE = 1.1
  private const val FRAME_BUDGET_MS = 14.0

  private val mainHandler = Handler(Looper.getMainLooper())
  private var rootRef: WeakReference<ZynthRootView>? = null
  private var rootLayoutListener: OnLayoutChangeListener? = null
  private var performanceOverlayView: View? = null
  @Volatile private var performanceEnabled: Boolean = false
  private val performanceJsResponseCount = AtomicInteger(0)
  private val performanceJsOnTimeResponseCount = AtomicInteger(0)
  private val performanceJsLateWindowCount = AtomicInteger(0)
  private val performanceJsPingIssuedAtNanos = AtomicLong(0L)
  private val performanceJsPingMarkedLate = AtomicBoolean(false)
  private var performanceNodeCount: Int = 0
  private var performanceUiFps: Int = 0
  private var performanceJsFps: Int = 0
  private var performanceRamMb: Int = 0
  private var performanceLastSampleMs: Long = 0L
  private val performanceJsPingPending = AtomicBoolean(false)
  private var performanceDragStartX: Float = 0f
  private var performanceDragStartY: Float = 0f
  private var performanceTouchDownRawX: Float = 0f
  private var performanceTouchDownRawY: Float = 0f
  private var performanceChevronPressed: Boolean = false
  private var performanceOverlayExpanded: Boolean = false
  private var uiFrameCallback: Choreographer.FrameCallback? = null
  private var uiWarnActive: Boolean = false
  private var jsWarnActive: Boolean = false
  private var uiWarnStreak: Int = 0
  private var jsWarnStreak: Int = 0
  private var uiRecoverStreak: Int = 0
  private var jsRecoverStreak: Int = 0
  private var performanceBudgetPasses: Long = 0L
  private var performanceLastPassMs: Double = 0.0
  private var performanceLastLayoutMs: Double = 0.0
  private var performanceLastYogaMs: Double = 0.0
  private var performanceLastYogaCalcMs: Double = 0.0
  private var performanceLastYogaMeasureMs: Double = 0.0
  private var performanceYogaMeasureTotalMs: Double = 0.0
  private val performanceYogaMeasureSamples = ArrayList<Double>()
  private var performanceShortestPassMs: Double = Double.MAX_VALUE
  private var performanceLongestPassMs: Double = 0.0
  private var performanceBudgetOverruns: Long = 0L
  private var performanceWindowPasses: Long = 0L
  private var performanceWindowConsumedFrames: Long = 0L
  private var performanceOverlayAllowed: Boolean = false
  private var performanceYogaSampleCount: Long = 0L
  private var chevronTypeface: Typeface? = null

  private var isDebuggable: Boolean = false

  fun attach(root: ZynthRootView) {
    rootRef = WeakReference(root)

    val context = root.context
    isDebuggable = (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
    performanceOverlayAllowed = isDebuggable || readProductionOverlayFlag()

    if (performanceOverlayAllowed) {
      installRootLayoutListener(root)
      mainHandler.post {
        if (performanceEnabled) {
          ensurePerformanceOverlay()
        }
      }
    }
  }

  fun detach() {
    rootRef?.get()?.let { root ->
      val listener = rootLayoutListener
      if (listener != null) {
        root.removeOnLayoutChangeListener(listener)
      }
    }
    rootLayoutListener = null
    rootRef = null
    isDebuggable = false
    performanceOverlayAllowed = false
    mainHandler.post {
      stopUiFrameLoop()
      dismissPerformanceOverlay()
      performanceEnabled = false
      resetPerformanceCounters()
    }
  }

  @JvmStatic
  fun setPerformanceOverlayEnabled(enabled: Boolean) {
    if (!performanceOverlayAllowed && enabled) return
    mainHandler.post {
      if (performanceEnabled == enabled) {
        if (enabled) {
          ensurePerformanceOverlay()
        }
        return@post
      }
      performanceEnabled = enabled
      resetPerformanceCounters()
      if (enabled) {
        startUiFrameLoop()
        ensurePerformanceOverlay()
        updatePerformanceOverlayLabels()
      } else {
        stopUiFrameLoop()
        dismissPerformanceOverlay()
      }
    }
  }

  @JvmStatic
  fun getPerformanceOverlaySnapshot(): Map<String, Any> {
    val yogaMeasureSummary = summarizeSamples(performanceYogaMeasureSamples)
    return mapOf(
      "enabled" to performanceEnabled,
      "ramMb" to performanceRamMb,
      "views" to performanceNodeCount,
      "uiFps" to performanceUiFps,
      "jsFps" to performanceJsFps,
      "lastYogaMs" to performanceLastYogaMs,
      "lastYogaCalcMs" to performanceLastYogaCalcMs,
      "lastYogaMeasureMs" to performanceLastYogaMeasureMs,
      "lastPassMs" to performanceLastYogaMs,
      "shortestPassMs" to if (performanceBudgetPasses > 0L) performanceShortestPassMs else 0.0,
      "longestPassMs" to performanceLongestPassMs,
      "budgetOverruns" to performanceBudgetOverruns,
      "totalPasses" to performanceBudgetPasses,
      "avgYogaMeasureMs" to if (performanceYogaMeasureSamples.isNotEmpty()) {
        performanceYogaMeasureTotalMs / performanceYogaMeasureSamples.size.toDouble()
      } else {
        0.0
      },
      "minYogaMeasureMs" to (yogaMeasureSummary["min"] ?: 0.0),
      "maxYogaMeasureMs" to (yogaMeasureSummary["max"] ?: 0.0),
      "p50YogaMeasureMs" to (yogaMeasureSummary["p50"] ?: 0.0),
      "p90YogaMeasureMs" to (yogaMeasureSummary["p90"] ?: 0.0),
      "p95YogaMeasureMs" to (yogaMeasureSummary["p95"] ?: 0.0),
      "p99YogaMeasureMs" to (yogaMeasureSummary["p99"] ?: 0.0),
      "yogaMeasureSampleCount" to performanceYogaMeasureSamples.size,
    )
  }

  @JvmStatic
  fun setPerformanceSamplingEnabled(enabled: Boolean) {
    mainHandler.post {
      if (performanceEnabled == enabled) {
        return@post
      }
      performanceEnabled = enabled
      resetPerformanceCounters()
      if (!enabled) {
        stopUiFrameLoop()
        dismissPerformanceOverlay()
      }
    }
  }

  @JvmStatic
  fun resetPerformanceStats() {
    mainHandler.post {
      resetPerformanceCounters()
      updatePerformanceOverlayLabels()
    }
  }

  @JvmStatic
  fun recordPerformanceFrame(frameMs: Double, layoutMs: Double, overBudget: Boolean, nodeCount: Int) {
    val update: () -> Unit = update@{
      if (!performanceEnabled) {
        return@update
      }
      performanceNodeCount = nodeCount.coerceAtLeast(0)
      ensurePerformanceOverlay()
      rootView()?.bringChildToFront(performanceOverlayView)
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      update()
    } else {
      mainHandler.post { update() }
    }
  }

  @JvmStatic
  fun recordNativeYogaPass(yogaMs: Double, yogaCalculateMs: Double, measureMs: Double) {
    val update: () -> Unit = update@{
      if (!performanceEnabled) {
        return@update
      }
      val totalYogaMs = sanitizeDuration(yogaMs)
      performanceLastYogaMs = totalYogaMs
      performanceLastYogaCalcMs = sanitizeDuration(yogaCalculateMs)
      performanceLastYogaMeasureMs = sanitizeDuration(measureMs)
      performanceYogaMeasureTotalMs += performanceLastYogaMeasureMs
      performanceYogaMeasureSamples.add(performanceLastYogaMeasureMs)
      recordBudgetPass(totalYogaMs, totalYogaMs > FRAME_BUDGET_MS)
      updatePerformanceOverlayLabels()
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      update()
    } else {
      mainHandler.post { update() }
    }
  }

  @JvmStatic
  fun requestPerformanceJsPing(): Boolean {
    if (!performanceEnabled) {
      performanceJsPingPending.set(false)
      performanceJsPingIssuedAtNanos.set(0L)
      performanceJsPingMarkedLate.set(false)
      return false
    }
    val nowNanos = SystemClock.elapsedRealtimeNanos()
    val issuedAtNanos = performanceJsPingIssuedAtNanos.get()
    if (
      performanceJsPingPending.get() &&
      issuedAtNanos > 0L &&
      nowNanos - issuedAtNanos > jsResponseBudgetNanos() &&
      performanceJsPingMarkedLate.compareAndSet(false, true)
    ) {
      performanceJsLateWindowCount.incrementAndGet()
    }
    if (!performanceJsPingPending.compareAndSet(false, true)) {
      return false
    }
    performanceJsPingIssuedAtNanos.set(nowNanos)
    performanceJsPingMarkedLate.set(false)
    return true
  }

  @JvmStatic
  fun recordPerformanceJsPing() {
    performanceJsPingPending.set(false)
    if (!performanceEnabled) return
    val nowNanos = SystemClock.elapsedRealtimeNanos()
    val issuedAtNanos = performanceJsPingIssuedAtNanos.getAndSet(0L)
    performanceJsPingMarkedLate.set(false)
    performanceJsResponseCount.incrementAndGet()
    if (issuedAtNanos > 0L && nowNanos - issuedAtNanos <= jsResponseBudgetNanos()) {
      performanceJsOnTimeResponseCount.incrementAndGet()
    }
  }

  private fun rootView(): ZynthRootView? {
    return rootRef?.get()
  }

  private fun removeView(view: View?) {
    val parent = view?.parent as? ViewGroup ?: return
    parent.removeView(view)
  }

  private fun resetPerformanceCounters() {
    performanceJsResponseCount.set(0)
    performanceJsOnTimeResponseCount.set(0)
    performanceJsLateWindowCount.set(0)
    performanceJsPingIssuedAtNanos.set(0L)
    performanceJsPingMarkedLate.set(false)
    performanceNodeCount = 0
    performanceUiFps = 0
    performanceJsFps = 0
    performanceRamMb = 0
    performanceLastSampleMs = SystemClock.elapsedRealtime()
    performanceJsPingPending.set(false)
    uiWarnActive = false
    jsWarnActive = false
    uiWarnStreak = 0
    jsWarnStreak = 0
    uiRecoverStreak = 0
    jsRecoverStreak = 0
    performanceBudgetPasses = 0L
    performanceLastPassMs = 0.0
    performanceLastLayoutMs = 0.0
    performanceLastYogaMs = 0.0
    performanceLastYogaCalcMs = 0.0
    performanceLastYogaMeasureMs = 0.0
    performanceYogaMeasureTotalMs = 0.0
    performanceYogaMeasureSamples.clear()
    performanceShortestPassMs = Double.MAX_VALUE
    performanceLongestPassMs = 0.0
    performanceBudgetOverruns = 0L
    performanceWindowPasses = 0L
    performanceWindowConsumedFrames = 0L
    performanceYogaSampleCount = 0L
  }

  private fun startUiFrameLoop() {
    if (uiFrameCallback != null) return
    val callback = object : Choreographer.FrameCallback {
      override fun doFrame(frameTimeNanos: Long) {
        if (!performanceEnabled) return
        samplePerformanceIfNeeded()
        ensurePerformanceOverlay()
        val overlay = performanceOverlayView
        if (overlay != null) {
          rootView()?.bringChildToFront(overlay)
        }
        Choreographer.getInstance().postFrameCallback(this)
      }
    }
    uiFrameCallback = callback
    Choreographer.getInstance().postFrameCallback(callback)
  }

  private fun stopUiFrameLoop() {
    val callback = uiFrameCallback ?: return
    Choreographer.getInstance().removeFrameCallback(callback)
    uiFrameCallback = null
  }

  private fun ensurePerformanceOverlay() {
    if (!performanceEnabled) return
    val root = rootView() ?: return

    val existing = performanceOverlayView
    if (existing != null && existing.parent !== root) {
      removeView(existing)
      root.addView(existing)
      performanceOverlayView = existing
    }

    if (performanceOverlayView == null) {
      val insets = root.rootWindowInsets?.let { WindowInsetsCompat.toWindowInsetsCompat(it) }
      val topInset = insets?.getInsets(WindowInsetsCompat.Type.systemBars())?.top ?: statusBarHeight(root)
      val overlay = LinearLayout(root.context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(10), dp(6), dp(10), dp(6))
        background = roundedBackground(
          withAlpha(Color.parseColor("#09090B"), 0.62f),
          withAlpha(Color.parseColor("#6B7280"), 0.46f),
          dp(18).toFloat(),
        )
        layoutParams = FrameLayout.LayoutParams(dp(OVERLAY_WIDTH_DP), FrameLayout.LayoutParams.WRAP_CONTENT).apply {
          gravity = Gravity.TOP or Gravity.START
          marginStart = dp(16)
          topMargin = topInset + dp(10)
        }
        elevation = 100_001f
        setOnTouchListener { view, event ->
          when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
              performanceDragStartX = event.rawX - view.x
              performanceDragStartY = event.rawY - view.y
              performanceTouchDownRawX = event.rawX
              performanceTouchDownRawY = event.rawY
              performanceChevronPressed = event.x >= view.width - dp(52) && event.y <= dp(OVERLAY_TAP_HEIGHT_DP)
              true
            }
            MotionEvent.ACTION_MOVE -> {
              view.x = event.rawX - performanceDragStartX
              view.y = event.rawY - performanceDragStartY
              clampPerformanceOverlayPosition(view)
              true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
              val dx = event.rawX - performanceTouchDownRawX
              val dy = event.rawY - performanceTouchDownRawY
              val wasTap = (dx * dx + dy * dy) <= (dp(8) * dp(8)).toFloat()
              if (event.actionMasked == MotionEvent.ACTION_UP && performanceChevronPressed && wasTap) {
                togglePerformanceOverlayExpanded()
              } else {
                clampPerformanceOverlayPosition(view)
              }
              performanceChevronPressed = false
              true
            }
            else -> false
          }
        }
      }

      val ram = performanceMetricColumn(root.context, "RAM", PERF_RAM_VALUE_TAG, Color.parseColor("#E5E7EB"))
      val views = performanceMetricColumn(root.context, "VIEWS", PERF_VIEWS_VALUE_TAG, Color.parseColor("#E5E7EB"))
      val ui = performanceMetricColumn(root.context, "UI", PERF_UI_VALUE_TAG, Color.parseColor("#4ADE80"))
      val js = performanceMetricColumn(root.context, "JS", PERF_JS_VALUE_TAG, Color.parseColor("#4ADE80"))

      val header = LinearLayout(root.context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(OVERLAY_TAP_HEIGHT_DP)
      }
      val chevron = TextView(root.context).apply {
        id = PERF_CHEVRON_TAG
        text = CHEVRON_GLYPH
        setTextColor(Color.parseColor("#E5E7EB"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        gravity = Gravity.CENTER
        includeFontPadding = false
        typeface = chevronTypeface(root.context)
      }
      header.addView(ram, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      header.addView(views, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      header.addView(ui, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      header.addView(js, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      header.addView(chevron, LinearLayout.LayoutParams(dp(34), LinearLayout.LayoutParams.WRAP_CONTENT))

      val details = LinearLayout(root.context).apply {
        id = PERF_DETAILS_TAG
        orientation = LinearLayout.VERTICAL
        visibility = if (performanceOverlayExpanded) View.VISIBLE else View.GONE
        setPadding(0, dp(8), 0, 0)
      }
      details.addView(performanceDetailRow(root.context, "Last Measure", PERF_LAST_YOGA_VALUE_TAG))
      details.addView(performanceDetailRow(root.context, "Shortest", PERF_SHORTEST_PASS_VALUE_TAG))
      details.addView(performanceDetailRow(root.context, "Longest", PERF_LONGEST_PASS_VALUE_TAG))
      details.addView(performanceDetailRow(root.context, "Overruns", PERF_OVERRUNS_VALUE_TAG))
      details.addView(performanceDetailRow(root.context, "Passes", PERF_PASSES_VALUE_TAG))

      overlay.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
      overlay.addView(details, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

      performanceOverlayView = overlay
      root.addView(overlay)
      ensureOverlaySizeAndPosition(overlay, topInset)
      applyPerformanceOverlayExpandedState(overlay)
    }

    performanceOverlayView?.let { overlay ->
      clampPerformanceOverlayPosition(overlay)
      root.bringChildToFront(overlay)
    }
  }

  private fun dismissPerformanceOverlay() {
    removeView(performanceOverlayView)
    performanceOverlayView = null
    performanceJsPingPending.set(false)
  }

  private fun samplePerformanceIfNeeded() {
    val nowMs = SystemClock.elapsedRealtime()
    if (performanceLastSampleMs <= 0L) {
      performanceLastSampleMs = nowMs
      return
    }
    val elapsedMs = nowMs - performanceLastSampleMs
    if (elapsedMs < 1_000L) return

    val targetFps = targetFps()
    val root = rootView()
    if (root != null && !root.hasWindowFocus()) {
      performanceUiFps = targetFps
      performanceJsFps = targetFps
      uiWarnActive = false
      jsWarnActive = false
      uiWarnStreak = 0
      jsWarnStreak = 0
      uiRecoverStreak = 0
      jsRecoverStreak = 0
      performanceRamMb = readProcessRamMb()
      performanceNodeCount = countViews(root)
      resetSampleWindow()
      performanceLastSampleMs = nowMs
      updatePerformanceOverlayLabels()
      return
    }

    performanceUiFps = computeBudgetUiFps(targetFps)
    performanceJsFps = computeJsFps(targetFps)
    if (performanceUiFps >= targetFps - UI_FPS_DISPLAY_DEADBAND) {
      performanceUiFps = targetFps
    }
    if (performanceJsFps >= targetFps - JS_FPS_DISPLAY_DEADBAND) {
      performanceJsFps = targetFps
    }
    updateAlertState(targetFps)
    performanceRamMb = readProcessRamMb()
    performanceNodeCount = countViews(root)
    resetSampleWindow()
    performanceLastSampleMs = nowMs
    updatePerformanceOverlayLabels()
  }

  private fun readProcessRamMb(): Int {
    val memoryInfo = Debug.MemoryInfo()
    Debug.getMemoryInfo(memoryInfo)
    return (memoryInfo.totalPss / 1024f).roundToInt().coerceAtLeast(0)
  }

  private fun updatePerformanceOverlayLabels() {
    val overlay = performanceOverlayView as? ViewGroup ?: return
    val ram = overlay.findViewById<TextView>(PERF_RAM_VALUE_TAG)
    val views = overlay.findViewById<TextView>(PERF_VIEWS_VALUE_TAG)
    val ui = overlay.findViewById<TextView>(PERF_UI_VALUE_TAG)
    val js = overlay.findViewById<TextView>(PERF_JS_VALUE_TAG)
    val lastYoga = overlay.findViewById<TextView>(PERF_LAST_YOGA_VALUE_TAG)
    val shortestPass = overlay.findViewById<TextView>(PERF_SHORTEST_PASS_VALUE_TAG)
    val longestPass = overlay.findViewById<TextView>(PERF_LONGEST_PASS_VALUE_TAG)
    val overruns = overlay.findViewById<TextView>(PERF_OVERRUNS_VALUE_TAG)
    val passes = overlay.findViewById<TextView>(PERF_PASSES_VALUE_TAG)
    ram?.text = "${performanceRamMb}MB"
    views?.text = performanceNodeCount.toString()
    ui?.text = performanceUiFps.toString()
    js?.text = performanceJsFps.toString()
    lastYoga?.text = formatMs(performanceLastYogaMs)
    shortestPass?.text = formatMs(if (performanceBudgetPasses > 0L) performanceShortestPassMs else 0.0)
    longestPass?.text = formatMs(performanceLongestPassMs)
    overruns?.text = performanceBudgetOverruns.toString()
    passes?.text = performanceBudgetPasses.toString()
    val good = Color.parseColor("#4ADE80")
    val warn = Color.parseColor("#FACC15")
    ui?.setTextColor(if (uiWarnActive) warn else good)
    js?.setTextColor(if (jsWarnActive) warn else good)
  }

  private fun recordBudgetPass(durationMs: Double, overBudget: Boolean) {
    if (!durationMs.isFinite() || durationMs < 0.0) return
    performanceBudgetPasses += 1L
    performanceWindowPasses += 1L
    performanceWindowConsumedFrames += consumedFrameSlots(durationMs)
    performanceLastPassMs = durationMs
    performanceLastLayoutMs = durationMs
    performanceYogaSampleCount += 1L
    performanceShortestPassMs = kotlin.math.min(performanceShortestPassMs, durationMs)
    if (performanceYogaSampleCount > 3L) {
      performanceLongestPassMs = kotlin.math.max(performanceLongestPassMs, durationMs)
    }
    if (overBudget) {
      performanceBudgetOverruns += 1L
    }
    updatePerformanceOverlayLabels()
  }

  private fun sanitizeDuration(value: Double): Double {
    if (!value.isFinite() || value < 0.0) return 0.0
    return value
  }

  private fun summarizeSamples(samples: List<Double>): Map<String, Double> {
    if (samples.isEmpty()) {
      return emptyMap()
    }
    val sorted = samples.sorted()
    return mapOf(
      "min" to (sorted.firstOrNull() ?: 0.0),
      "max" to (sorted.lastOrNull() ?: 0.0),
      "p50" to percentile(sorted, 0.5),
      "p90" to percentile(sorted, 0.9),
      "p95" to percentile(sorted, 0.95),
      "p99" to percentile(sorted, 0.99),
    )
  }

  private fun percentile(sorted: List<Double>, ratio: Double): Double {
    if (sorted.isEmpty()) {
      return 0.0
    }
    val index = kotlin.math.min(
      sorted.size - 1,
      kotlin.math.max(0, kotlin.math.ceil(sorted.size.toDouble() * ratio).toInt() - 1),
    )
    return sorted[index]
  }

  private fun readProductionOverlayFlag(): Boolean {
    val rawFlag = System.getProperty("ZYNTH_ANDROID_DEBUG_OVERLAY")?.trim()
    if (rawFlag.isNullOrEmpty()) {
      return false
    }
    return rawFlag == "1" ||
      rawFlag.equals("true", ignoreCase = true) ||
      rawFlag.equals("yes", ignoreCase = true) ||
      rawFlag.equals("on", ignoreCase = true)
  }

  private fun targetFps(): Int {
    val refreshRate = rootView()?.display?.refreshRate ?: 60f
    if (!refreshRate.isFinite() || refreshRate < 30f) return 60
    return refreshRate.roundToInt().coerceAtLeast(30)
  }

  private fun targetFrameIntervalNanos(): Long {
    return (1_000_000_000.0 / targetFps().toDouble()).roundToInt().toLong().coerceAtLeast(1L)
  }

  private fun jsResponseBudgetNanos(): Long {
    return (targetFrameIntervalNanos().toDouble() * JS_RESPONSE_BUDGET_GRACE).roundToInt().toLong().coerceAtLeast(1L)
  }

  private fun computeBudgetUiFps(targetFps: Int): Int {
    if (performanceWindowPasses <= 0L || performanceWindowConsumedFrames <= 0L) {
      return targetFps
    }
    val deliveredRatio = performanceWindowPasses.toDouble() / performanceWindowConsumedFrames.toDouble()
    return (deliveredRatio * targetFps.toDouble()).roundToInt().coerceIn(0, targetFps)
  }

  private fun computeJsFps(targetFps: Int): Int {
    val responses = performanceJsResponseCount.getAndSet(0)
    val onTimeResponses = performanceJsOnTimeResponseCount.getAndSet(0)
    val lateWindows = performanceJsLateWindowCount.getAndSet(0)
    val windows = (responses + lateWindows).coerceAtLeast(1)
    val responsiveRatio = onTimeResponses.toDouble() / windows.toDouble()
    return (responsiveRatio * targetFps.toDouble()).roundToInt().coerceIn(0, targetFps)
  }

  private fun resetSampleWindow() {
    performanceWindowPasses = 0L
    performanceWindowConsumedFrames = 0L
    performanceJsResponseCount.set(0)
    performanceJsOnTimeResponseCount.set(0)
    performanceJsLateWindowCount.set(0)
  }

  private fun consumedFrameSlots(frameMs: Double): Long {
    return kotlin.math.ceil(frameMs / FRAME_BUDGET_MS).toLong().coerceAtLeast(1L)
  }

  private fun updateAlertState(targetFps: Int) {
    val warnThreshold = (targetFps - FPS_WARN_OFFSET).coerceAtLeast(1)
    val recoverThreshold = (targetFps - FPS_RECOVER_OFFSET).coerceAtLeast(warnThreshold)

    if (uiWarnActive) {
      if (performanceUiFps >= recoverThreshold) {
        uiRecoverStreak += 1
        if (uiRecoverStreak >= FPS_RECOVER_SAMPLES) {
          uiWarnActive = false
          uiRecoverStreak = 0
          uiWarnStreak = 0
        }
      } else {
        uiRecoverStreak = 0
      }
    } else {
      if (performanceUiFps <= warnThreshold) {
        uiWarnStreak += 1
        if (uiWarnStreak >= FPS_WARN_SAMPLES) {
          uiWarnActive = true
          uiWarnStreak = 0
          uiRecoverStreak = 0
        }
      } else {
        uiWarnStreak = 0
      }
    }

    if (jsWarnActive) {
      if (performanceJsFps >= recoverThreshold) {
        jsRecoverStreak += 1
        if (jsRecoverStreak >= FPS_RECOVER_SAMPLES) {
          jsWarnActive = false
          jsRecoverStreak = 0
          jsWarnStreak = 0
        }
      } else {
        jsRecoverStreak = 0
      }
    } else {
      if (performanceJsFps <= warnThreshold) {
        jsWarnStreak += 1
        if (jsWarnStreak >= FPS_WARN_SAMPLES) {
          jsWarnActive = true
          jsWarnStreak = 0
          jsRecoverStreak = 0
        }
      } else {
        jsWarnStreak = 0
      }
    }
  }

  private fun performanceMetricColumn(
    context: Context,
    title: String,
    valueId: Int,
    valueColor: Int,
  ): LinearLayout {
    return LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      addView(TextView(context).apply {
        text = title
        setTextColor(Color.parseColor("#9CA3AF"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 8.5f)
        setTypeface(Typeface.DEFAULT, Typeface.BOLD)
      })
      addView(TextView(context).apply {
        id = valueId
        text = "0"
        setTextColor(valueColor)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        typeface = Typeface.MONOSPACE
        setPadding(0, dp(2), 0, 0)
      })
    }
  }

  private fun performanceDetailRow(
    context: Context,
    title: String,
    valueId: Int,
  ): LinearLayout {
    return LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      addView(TextView(context).apply {
        text = title
        setTextColor(Color.parseColor("#9CA3AF"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
      }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      addView(TextView(context).apply {
        id = valueId
        text = "0"
        setTextColor(Color.parseColor("#E5E7EB"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
        typeface = Typeface.MONOSPACE
        gravity = Gravity.END
      }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }
  }

  private fun togglePerformanceOverlayExpanded() {
    performanceOverlayExpanded = !performanceOverlayExpanded
    applyPerformanceOverlayExpandedState(performanceOverlayView)
    updatePerformanceOverlayLabels()
  }

  private fun applyPerformanceOverlayExpandedState(view: View?) {
    val overlay = view as? ViewGroup ?: return
    overlay.findViewById<TextView>(PERF_CHEVRON_TAG)?.apply {
      text = CHEVRON_GLYPH
      scaleY = if (performanceOverlayExpanded) 1f else -1f
      typeface = chevronTypeface(context)
    }
    overlay.findViewById<View>(PERF_DETAILS_TAG)?.visibility =
      if (performanceOverlayExpanded) View.VISIBLE else View.GONE
    val params = overlay.layoutParams
    if (params != null && params.height != ViewGroup.LayoutParams.WRAP_CONTENT) {
      params.height = ViewGroup.LayoutParams.WRAP_CONTENT
      overlay.layoutParams = params
    }
    val width = if (overlay.width > 0) overlay.width else dp(OVERLAY_WIDTH_DP)
    val left = overlay.left
    val top = overlay.top
    val widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
    val heightSpec = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    overlay.measure(widthSpec, heightSpec)
    overlay.layout(left, top, left + width, top + overlay.measuredHeight)
    clampPerformanceOverlayPosition(overlay)
  }

  private fun formatMs(value: Double): String {
    return "%.2fms".format(value)
  }

  private fun chevronTypeface(context: Context): Typeface {
    val cached = chevronTypeface
    if (cached != null) return cached
    val loaded = runCatching {
      Typeface.createFromAsset(context.assets, RUNTIME_FONT_ASSET)
    }.getOrNull() ?: Typeface.DEFAULT_BOLD
    chevronTypeface = loaded
    return loaded
  }

  private fun clampPerformanceOverlayPosition(view: View) {
    val root = rootView() ?: return
    val insets = root.rootWindowInsets?.let { WindowInsetsCompat.toWindowInsetsCompat(it) }
    val topInset = insets?.getInsets(WindowInsetsCompat.Type.systemBars())?.top ?: statusBarHeight(root)
    val bottomInset = insets?.getInsets(WindowInsetsCompat.Type.systemBars())?.bottom ?: 0
    val rootWidth = if (root.width > 0) root.width else root.resources.displayMetrics.widthPixels
    val rootHeight = if (root.height > 0) root.height else root.resources.displayMetrics.heightPixels
    val viewWidth = if (view.width > 0) view.width else dp(OVERLAY_WIDTH_DP)
    val viewHeight = if (view.height > 0) view.height else view.measuredHeight.coerceAtLeast(dp(OVERLAY_TAP_HEIGHT_DP))
    val minX = dp(8).toFloat()
    val maxX = (rootWidth - viewWidth - dp(8)).toFloat().coerceAtLeast(minX)
    val minY = (topInset + dp(8)).toFloat()
    val maxY = (rootHeight - bottomInset - viewHeight - dp(8)).toFloat().coerceAtLeast(minY)
    view.x = view.x.coerceIn(minX, maxX)
    view.y = view.y.coerceIn(minY, maxY)
  }

  private fun statusBarHeight(view: View): Int {
    val id = view.resources.getIdentifier("status_bar_height", "dimen", "android")
    if (id <= 0) return 0
    return view.resources.getDimensionPixelSize(id)
  }

  private fun roundedBackground(bgColor: Int, borderColor: Int, radius: Float): android.graphics.drawable.GradientDrawable {
    return android.graphics.drawable.GradientDrawable().apply {
      shape = android.graphics.drawable.GradientDrawable.RECTANGLE
      cornerRadius = radius
      setColor(bgColor)
      setStroke(dp(1), borderColor)
    }
  }

  private fun withAlpha(color: Int, alpha: Float): Int {
    val a = (alpha.coerceIn(0f, 1f) * 255f).toInt()
    return (color and 0x00FFFFFF) or (a shl 24)
  }

  private fun dp(value: Int): Int {
    val density = rootView()?.resources?.displayMetrics?.density ?: 1f
    return (value * density).toInt()
  }

  private fun installRootLayoutListener(root: ZynthRootView) {
    val existing = rootLayoutListener
    if (existing != null) {
      root.removeOnLayoutChangeListener(existing)
    }
    val listener = OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      val performance = performanceOverlayView
      if (performance != null) {
        val insets = root.rootWindowInsets?.let { WindowInsetsCompat.toWindowInsetsCompat(it) }
        val topInset = insets?.getInsets(WindowInsetsCompat.Type.systemBars())?.top ?: statusBarHeight(root)
        ensureOverlaySizeAndPosition(performance, topInset)
        clampPerformanceOverlayPosition(performance)
      }
    }
    root.addOnLayoutChangeListener(listener)
    rootLayoutListener = listener
  }

  private fun countViews(root: View?): Int {
    if (root == null || root === performanceOverlayView) return 0
    if (root !is ViewGroup) return 1
    var total = 1
    for (index in 0 until root.childCount) {
      total += countViews(root.getChildAt(index))
    }
    return total
  }

  private fun ensureOverlaySizeAndPosition(view: View, topInset: Int) {
    if (view.width > 0 && view.height > 0) {
      return
    }
    val width = dp(OVERLAY_WIDTH_DP)
    val left = dp(16)
    val top = topInset + dp(10)
    val widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
    val heightSpec = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    view.measure(widthSpec, heightSpec)
    view.layout(left, top, left + width, top + view.measuredHeight)
    if (view.x == 0f && view.y == 0f) {
      view.x = left.toFloat()
      view.y = top.toFloat()
    }
  }
}
