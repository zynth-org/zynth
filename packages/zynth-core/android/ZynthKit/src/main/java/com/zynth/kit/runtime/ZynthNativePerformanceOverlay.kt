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
  private const val OVERLAY_WIDTH_DP = 330
  private const val OVERLAY_HEIGHT_DP = 62
  private const val OVERLAY_EXPANDED_HEIGHT_DP = 142
  private const val FPS_EMA_ALPHA = 0.26
  private const val FPS_WARN_OFFSET = 6
  private const val FPS_RECOVER_OFFSET = 3
  private const val FPS_WARN_SAMPLES = 3
  private const val FPS_RECOVER_SAMPLES = 2
  private const val UI_FPS_DISPLAY_DEADBAND = 2
  private const val JS_FPS_DISPLAY_DEADBAND = 2

  private val mainHandler = Handler(Looper.getMainLooper())
  private var rootRef: WeakReference<ZynthRootView>? = null
  private var rootLayoutListener: OnLayoutChangeListener? = null
  private var performanceOverlayView: View? = null
  @Volatile private var performanceEnabled: Boolean = false
  private var performanceUiFrameCount: Int = 0
  private val performanceJsTickCount = AtomicInteger(0)
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
  private var uiFpsEma: Double = -1.0
  private var jsFpsEma: Double = -1.0
  private var uiWarnActive: Boolean = false
  private var jsWarnActive: Boolean = false
  private var uiWarnStreak: Int = 0
  private var jsWarnStreak: Int = 0
  private var uiRecoverStreak: Int = 0
  private var jsRecoverStreak: Int = 0
  private var performanceBudgetPasses: Long = 0L
  private var performanceLastPassMs: Double = 0.0
  private var performanceShortestPassMs: Double = Double.MAX_VALUE
  private var performanceLongestPassMs: Double = 0.0
  private var performanceBudgetOverruns: Long = 0L

  fun attach(root: ZynthRootView) {
    rootRef = WeakReference(root)
    installRootLayoutListener(root)
    mainHandler.post {
      if (performanceEnabled) {
        ensurePerformanceOverlay()
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
    mainHandler.post {
      stopUiFrameLoop()
      dismissPerformanceOverlay()
      performanceEnabled = false
      resetPerformanceCounters()
    }
  }

  @JvmStatic
  fun setPerformanceOverlayEnabled(enabled: Boolean) {
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
    return mapOf(
      "enabled" to performanceEnabled,
      "ramMb" to performanceRamMb,
      "views" to performanceNodeCount,
      "uiFps" to performanceUiFps,
      "jsFps" to performanceJsFps,
      "lastPassMs" to performanceLastPassMs,
      "shortestPassMs" to if (performanceBudgetPasses > 0L) performanceShortestPassMs else 0.0,
      "longestPassMs" to performanceLongestPassMs,
      "budgetOverruns" to performanceBudgetOverruns,
      "totalPasses" to performanceBudgetPasses,
    )
  }

  @JvmStatic
  fun recordPerformanceFrame(frameMs: Double, overBudget: Boolean, nodeCount: Int) {
    val update: () -> Unit = update@{
      if (!performanceEnabled) {
        return@update
      }
      performanceNodeCount = nodeCount.coerceAtLeast(0)
      ensurePerformanceOverlay()
      recordBudgetPass(frameMs, overBudget)
      rootView()?.bringChildToFront(performanceOverlayView)
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
      return false
    }
    return performanceJsPingPending.compareAndSet(false, true)
  }

  @JvmStatic
  fun recordPerformanceJsPing() {
    performanceJsPingPending.set(false)
    if (!performanceEnabled) return
    performanceJsTickCount.incrementAndGet()
  }

  private fun rootView(): ZynthRootView? {
    return rootRef?.get()
  }

  private fun removeView(view: View?) {
    val parent = view?.parent as? ViewGroup ?: return
    parent.removeView(view)
  }

  private fun resetPerformanceCounters() {
    performanceUiFrameCount = 0
    performanceJsTickCount.set(0)
    performanceNodeCount = 0
    performanceUiFps = 0
    performanceJsFps = 0
    performanceRamMb = 0
    performanceLastSampleMs = SystemClock.elapsedRealtime()
    performanceJsPingPending.set(false)
    uiFpsEma = -1.0
    jsFpsEma = -1.0
    uiWarnActive = false
    jsWarnActive = false
    uiWarnStreak = 0
    jsWarnStreak = 0
    uiRecoverStreak = 0
    jsRecoverStreak = 0
    performanceBudgetPasses = 0L
    performanceLastPassMs = 0.0
    performanceShortestPassMs = Double.MAX_VALUE
    performanceLongestPassMs = 0.0
    performanceBudgetOverruns = 0L
  }

  private fun startUiFrameLoop() {
    if (uiFrameCallback != null) return
    val callback = object : Choreographer.FrameCallback {
      override fun doFrame(frameTimeNanos: Long) {
        if (!performanceEnabled) return
        performanceUiFrameCount += 1
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
        layoutParams = FrameLayout.LayoutParams(dp(OVERLAY_WIDTH_DP), dp(OVERLAY_HEIGHT_DP)).apply {
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
              performanceChevronPressed = event.x >= view.width - dp(52) && event.y <= dp(OVERLAY_HEIGHT_DP)
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
      }
      val chevron = TextView(root.context).apply {
        id = PERF_CHEVRON_TAG
        text = "v"
        setTextColor(Color.parseColor("#E5E7EB"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        gravity = Gravity.CENTER
        typeface = Typeface.DEFAULT_BOLD
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
      details.addView(performanceDetailRow(root.context, "Last Pass", PERF_LAST_PASS_VALUE_TAG))
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
      uiFpsEma = targetFps.toDouble()
      jsFpsEma = targetFps.toDouble()
      uiWarnActive = false
      jsWarnActive = false
      uiWarnStreak = 0
      jsWarnStreak = 0
      uiRecoverStreak = 0
      jsRecoverStreak = 0
      performanceRamMb = readProcessRamMb()
      performanceNodeCount = countViews(root)
      performanceUiFrameCount = 0
      performanceJsTickCount.set(0)
      performanceLastSampleMs = nowMs
      updatePerformanceOverlayLabels()
      return
    }

    val elapsedSec = elapsedMs / 1000.0
    val rawUiFps = (performanceUiFrameCount / elapsedSec).roundToInt().coerceAtLeast(0)
    val rawJsFps = (performanceJsTickCount.getAndSet(0) / elapsedSec).roundToInt().coerceAtLeast(0)
    uiFpsEma = smoothFps(uiFpsEma, rawUiFps)
    jsFpsEma = smoothFps(jsFpsEma, rawJsFps)
    performanceUiFps = uiFpsEma.roundToInt().coerceIn(0, targetFps)
    performanceJsFps = jsFpsEma.roundToInt().coerceIn(0, targetFps)
    if (performanceUiFps >= targetFps - UI_FPS_DISPLAY_DEADBAND) {
      performanceUiFps = targetFps
    }
    if (performanceJsFps >= targetFps - JS_FPS_DISPLAY_DEADBAND) {
      performanceJsFps = targetFps
    }
    updateAlertState(targetFps)
    performanceRamMb = readProcessRamMb()
    performanceNodeCount = countViews(root)
    performanceUiFrameCount = 0
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
    val lastPass = overlay.findViewById<TextView>(PERF_LAST_PASS_VALUE_TAG)
    val shortestPass = overlay.findViewById<TextView>(PERF_SHORTEST_PASS_VALUE_TAG)
    val longestPass = overlay.findViewById<TextView>(PERF_LONGEST_PASS_VALUE_TAG)
    val overruns = overlay.findViewById<TextView>(PERF_OVERRUNS_VALUE_TAG)
    val passes = overlay.findViewById<TextView>(PERF_PASSES_VALUE_TAG)
    ram?.text = "${performanceRamMb}MB"
    views?.text = performanceNodeCount.toString()
    ui?.text = performanceUiFps.toString()
    js?.text = performanceJsFps.toString()
    lastPass?.text = formatMs(performanceLastPassMs)
    shortestPass?.text = formatMs(if (performanceBudgetPasses > 0L) performanceShortestPassMs else 0.0)
    longestPass?.text = formatMs(performanceLongestPassMs)
    overruns?.text = performanceBudgetOverruns.toString()
    passes?.text = performanceBudgetPasses.toString()
    val good = Color.parseColor("#4ADE80")
    val warn = Color.parseColor("#FACC15")
    ui?.setTextColor(if (uiWarnActive) warn else good)
    js?.setTextColor(if (jsWarnActive) warn else good)
  }

  private fun recordBudgetPass(frameMs: Double, overBudget: Boolean) {
    if (!frameMs.isFinite() || frameMs < 0.0) return
    performanceBudgetPasses += 1L
    performanceLastPassMs = frameMs
    performanceShortestPassMs = kotlin.math.min(performanceShortestPassMs, frameMs)
    performanceLongestPassMs = kotlin.math.max(performanceLongestPassMs, frameMs)
    if (overBudget) {
      performanceBudgetOverruns += 1L
    }
    updatePerformanceOverlayLabels()
  }

  private fun smoothFps(previous: Double, raw: Int): Double {
    if (previous < 0.0) return raw.toDouble()
    return (previous * (1.0 - FPS_EMA_ALPHA)) + (raw * FPS_EMA_ALPHA)
  }

  private fun targetFps(): Int {
    val refreshRate = rootView()?.display?.refreshRate ?: 60f
    if (!refreshRate.isFinite() || refreshRate < 30f) return 60
    return refreshRate.roundToInt().coerceAtLeast(30)
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
    overlay.findViewById<TextView>(PERF_CHEVRON_TAG)?.text =
      if (performanceOverlayExpanded) "^" else "v"
    overlay.findViewById<View>(PERF_DETAILS_TAG)?.visibility =
      if (performanceOverlayExpanded) View.VISIBLE else View.GONE
    val targetHeight = dp(if (performanceOverlayExpanded) OVERLAY_EXPANDED_HEIGHT_DP else OVERLAY_HEIGHT_DP)
    val params = overlay.layoutParams
    if (params != null && params.height != targetHeight) {
      params.height = targetHeight
      overlay.layoutParams = params
    }
    val width = if (overlay.width > 0) overlay.width else dp(OVERLAY_WIDTH_DP)
    val left = overlay.left
    val top = overlay.top
    val widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
    val heightSpec = View.MeasureSpec.makeMeasureSpec(targetHeight, View.MeasureSpec.EXACTLY)
    overlay.measure(widthSpec, heightSpec)
    overlay.layout(left, top, left + width, top + targetHeight)
    clampPerformanceOverlayPosition(overlay)
  }

  private fun formatMs(value: Double): String {
    return "%.2fms".format(value)
  }

  private fun clampPerformanceOverlayPosition(view: View) {
    val root = rootView() ?: return
    val insets = root.rootWindowInsets?.let { WindowInsetsCompat.toWindowInsetsCompat(it) }
    val topInset = insets?.getInsets(WindowInsetsCompat.Type.systemBars())?.top ?: statusBarHeight(root)
    val bottomInset = insets?.getInsets(WindowInsetsCompat.Type.systemBars())?.bottom ?: 0
    val rootWidth = if (root.width > 0) root.width else root.resources.displayMetrics.widthPixels
    val rootHeight = if (root.height > 0) root.height else root.resources.displayMetrics.heightPixels
    val viewWidth = if (view.width > 0) view.width else dp(OVERLAY_WIDTH_DP)
    val viewHeight = if (view.height > 0) view.height else dp(if (performanceOverlayExpanded) OVERLAY_EXPANDED_HEIGHT_DP else OVERLAY_HEIGHT_DP)
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
    if (root == null) return 0
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
    val height = dp(if (performanceOverlayExpanded) OVERLAY_EXPANDED_HEIGHT_DP else OVERLAY_HEIGHT_DP)
    val left = dp(16)
    val top = topInset + dp(10)
    val widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
    val heightSpec = View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
    view.measure(widthSpec, heightSpec)
    view.layout(left, top, left + width, top + height)
    if (view.x == 0f && view.y == 0f) {
      view.x = left.toFloat()
      view.y = top.toFloat()
    }
  }
}
