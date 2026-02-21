package com.zynth.kit.runtime

import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.View.OnLayoutChangeListener
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.zynth.kit.core.ZynthRootView
import java.lang.ref.WeakReference
import org.json.JSONObject

internal object ZynthNativeErrorOverlay {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var rootRef: WeakReference<ZynthRootView>? = null
  private var runtimeRef: WeakReference<ZynthRuntime>? = null
  private var fatalOverlayView: View? = null
  private var warningToastView: View? = null
  private var rootLayoutListener: OnLayoutChangeListener? = null
  private var warningCount: Int = 0
  private var warningMessage: String = ""

  private const val TOKENS_JSON = """
    {
      "layout": {
        "screenPadding": 20,
        "panelRadius": 18,
        "panelPadding": 16,
        "buttonHeight": 48
      },
      "colors": {
        "overlayBg": "#18181B",
        "panelBg": "#0F0F12",
        "border": "#27272A",
        "title": "#FAFAFA",
        "body": "#A1A1AA",
        "error": "#F87171",
        "warning": "#FACC15",
        "neutralButton": "#27272A",
        "dangerButton": "#DC2626",
        "warningButton": "#CA8A04",
        "buttonText": "#E4E4E7",
        "warningToastBg": "#242014",
        "warningToastBorder": "#695511"
      }
    }
  """

  private data class Tokens(
    val screenPadding: Int,
    val panelRadius: Int,
    val panelPadding: Int,
    val buttonHeight: Int,
    val overlayBg: Int,
    val panelBg: Int,
    val border: Int,
    val title: Int,
    val body: Int,
    val error: Int,
    val warning: Int,
    val neutralButton: Int,
    val dangerButton: Int,
    val warningButton: Int,
    val buttonText: Int,
    val warningToastBg: Int,
    val warningToastBorder: Int,
  )

  private val tokens: Tokens by lazy {
    val root = JSONObject(TOKENS_JSON)
    val layout = root.getJSONObject("layout")
    val colors = root.getJSONObject("colors")
    Tokens(
      screenPadding = layout.optInt("screenPadding", 20),
      panelRadius = layout.optInt("panelRadius", 18),
      panelPadding = layout.optInt("panelPadding", 16),
      buttonHeight = layout.optInt("buttonHeight", 48),
      overlayBg = Color.parseColor(colors.optString("overlayBg", "#18181B")),
      panelBg = Color.parseColor(colors.optString("panelBg", "#0F0F12")),
      border = Color.parseColor(colors.optString("border", "#27272A")),
      title = Color.parseColor(colors.optString("title", "#FAFAFA")),
      body = Color.parseColor(colors.optString("body", "#A1A1AA")),
      error = Color.parseColor(colors.optString("error", "#F87171")),
      warning = Color.parseColor(colors.optString("warning", "#FACC15")),
      neutralButton = Color.parseColor(colors.optString("neutralButton", "#27272A")),
      dangerButton = Color.parseColor(colors.optString("dangerButton", "#DC2626")),
      warningButton = Color.parseColor(colors.optString("warningButton", "#CA8A04")),
      buttonText = Color.parseColor(colors.optString("buttonText", "#E4E4E7")),
      warningToastBg = Color.parseColor(colors.optString("warningToastBg", "#242014")),
      warningToastBorder = Color.parseColor(colors.optString("warningToastBorder", "#695511")),
    )
  }

  private data class OverlayEntry(
    val topic: String,
    val kind: String,
    val message: String,
    val stack: String?,
  )

  fun attach(runtime: ZynthRuntime, root: ZynthRootView) {
    runtimeRef = WeakReference(runtime)
    rootRef = WeakReference(root)
    installRootLayoutListener(root)
  }

  fun detach() {
    rootRef?.get()?.let { root ->
      val listener = rootLayoutListener
      if (listener != null) {
        root.removeOnLayoutChangeListener(listener)
      }
    }
    rootLayoutListener = null
    runtimeRef = null
    rootRef = null
    mainHandler.post {
      removeView(fatalOverlayView)
      removeView(warningToastView)
      fatalOverlayView = null
      warningToastView = null
    }
  }

  @JvmStatic
  fun handleRawEvent(eventJson: String?) {
    if (eventJson.isNullOrBlank()) return
    val rootObject = runCatching { JSONObject(eventJson) }.getOrNull() ?: return
    val event = rootObject.optJSONObject("event") ?: rootObject
    val topic = event.optString("topic", "")
    if (topic.isBlank()) return

    if (topic == "log/console" && event.optString("level") == "warn") {
      val warning = parseEntry(event, "warning")
      mainHandler.post { showWarningToast(warning) }
      return
    }

    val isErrorTopic = topic.startsWith("error/") || topic.startsWith("crash/")
    if (!isErrorTopic) return
    val kind = if (topic.startsWith("crash/")) "crash" else "error"
    val entry = parseEntry(event, kind)
    mainHandler.post { showFatalOverlay(entry) }
  }

  private fun parseEntry(event: JSONObject, kind: String): OverlayEntry {
    val topic = event.optString("topic", "error/native")
    val data = event.opt("data")
    var message = "Unknown error"
    var stack: String? = null
    if (data is String) {
      val trimmed = data.trim()
      if (trimmed.isNotEmpty()) {
        val firstLineBreak = trimmed.indexOf('\n')
        if (firstLineBreak > 0) {
          message = trimmed.substring(0, firstLineBreak)
          stack = trimmed.substring(firstLineBreak + 1).takeIf { it.isNotBlank() }
        } else {
          message = trimmed
        }
      }
    } else if (data is JSONObject) {
      message = data.optString("message", data.optString("reason", data.optString("error", "Unknown error")))
      stack = data.optString("stack", data.optString("stacktrace", "")).takeIf { it.isNotBlank() }
    }
    if (message.isBlank()) {
      message = "Unknown error"
    }
    return OverlayEntry(topic = topic, kind = kind, message = message, stack = stack)
  }

  private fun removeView(view: View?) {
    val parent = view?.parent as? ViewGroup ?: return
    parent.removeView(view)
  }

  private fun rootView(): ZynthRootView? {
    return rootRef?.get()
  }

  private fun showFatalOverlay(entry: OverlayEntry) {
    val root = rootView() ?: return
    removeView(warningToastView)
    warningToastView = null

    val container = FrameLayout(root.context).apply {
      setBackgroundColor(tokens.overlayBg)
      isClickable = true
      isFocusable = true
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
      elevation = 99_999f
    }

    val panel = LinearLayout(root.context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(tokens.panelPadding), dp(tokens.panelPadding), dp(tokens.panelPadding), dp(tokens.panelPadding))
      background = roundedBackground(tokens.panelBg, tokens.border, dp(tokens.panelRadius).toFloat())
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      ).apply {
        gravity = Gravity.CENTER
        marginStart = dp(tokens.screenPadding)
        marginEnd = dp(tokens.screenPadding)
      }
    }

    val title = TextView(root.context).apply {
      text = if (entry.kind == "crash") "Native Crash" else "Runtime Error"
      setTextColor(tokens.title)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      setTypeface(typeface, Typeface.BOLD)
    }
    val subtitle = TextView(root.context).apply {
      text = entry.message
      setTextColor(if (entry.kind == "warning") tokens.warning else tokens.error)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      setPadding(0, dp(8), 0, 0)
      maxLines = 8
      ellipsize = TextUtils.TruncateAt.END
    }
    val topicView = TextView(root.context).apply {
      text = entry.topic
      setTextColor(tokens.body)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      setPadding(0, dp(6), 0, 0)
    }

    panel.addView(title)
    panel.addView(subtitle)
    panel.addView(topicView)

    val stack = entry.stack
    if (!stack.isNullOrBlank()) {
      val stackScroll = ScrollView(root.context).apply {
        layoutParams = LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.MATCH_PARENT,
          dp(220),
        ).apply {
          topMargin = dp(12)
        }
        setPadding(dp(10), dp(10), dp(10), dp(10))
        background = roundedBackground(Color.parseColor("#18181B"), tokens.border, dp(12).toFloat())
      }
      val stackText = TextView(root.context).apply {
        text = stack
        setTextColor(tokens.body)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        typeface = Typeface.MONOSPACE
      }
      stackScroll.addView(stackText)
      panel.addView(stackScroll)
    }

    val actions = LinearLayout(root.context).apply {
      orientation = LinearLayout.HORIZONTAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(12) }
      gravity = Gravity.CENTER_VERTICAL
    }

    val dismissButton = actionButton(root.context, "Dismiss", tokens.neutralButton) {
      removeView(container)
      fatalOverlayView = null
    }
    val reloadButton = actionButton(root.context, "Reload", tokens.dangerButton) {
      runtimeRef?.get()?.requestNativeOverlayReload()
      removeView(container)
      fatalOverlayView = null
    }
    val buttonLp = LinearLayout.LayoutParams(0, dp(tokens.buttonHeight), 1f)
    val buttonLpWithGap = LinearLayout.LayoutParams(0, dp(tokens.buttonHeight), 1f).apply { marginStart = dp(8) }
    actions.addView(dismissButton, buttonLp)
    actions.addView(reloadButton, buttonLpWithGap)
    panel.addView(actions)

    container.addView(panel)
    removeView(fatalOverlayView)
    root.addView(container)
    fatalOverlayView = container
    forceLayoutInRoot(root, container)
  }

  private fun showWarningToast(entry: OverlayEntry) {
    if (fatalOverlayView != null) return
    val root = rootView() ?: return
    warningCount += 1
    warningMessage = entry.message

    val toast = warningToastView ?: run {
      val host = FrameLayout(root.context).apply {
        layoutParams = FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.MATCH_PARENT,
          FrameLayout.LayoutParams.MATCH_PARENT,
        )
        isClickable = false
        isFocusable = false
        elevation = 99_998f
      }
      val container = LinearLayout(root.context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(12), dp(10), dp(12), dp(10))
        background = roundedBackground(tokens.warningToastBg, tokens.warningToastBorder, dp(20).toFloat())
        layoutParams = FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.MATCH_PARENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        ).apply {
          gravity = Gravity.BOTTOM
          marginStart = dp(tokens.screenPadding)
          marginEnd = dp(tokens.screenPadding)
          bottomMargin = dp(24)
        }
        elevation = 99_998f
      }
      val label = TextView(root.context).apply {
        id = View.generateViewId()
        setTextColor(tokens.warning)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        setTypeface(typeface, Typeface.BOLD)
      }
      val close = Button(root.context).apply {
        text = "Close"
        setTextColor(tokens.buttonText)
        setBackgroundColor(tokens.neutralButton)
        setOnClickListener {
          removeView(warningToastView)
          warningToastView = null
          warningCount = 0
          warningMessage = ""
        }
      }
      container.addView(label, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      container.addView(close, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40)))
      host.addView(container)
      root.addView(host)
      warningToastView = host
      forceLayoutInRoot(root, host)
      host
    }
    val toastContainer = (toast as ViewGroup).getChildAt(0) as? ViewGroup
    val label = toastContainer?.getChildAt(0) as? TextView
    label?.text = if (warningCount > 1) {
      "Warning ($warningCount): $warningMessage"
    } else {
      "Warning: $warningMessage"
    }
  }

  private fun actionButton(context: android.content.Context, label: String, bgColor: Int, onPress: () -> Unit): Button {
    return Button(context).apply {
      text = label
      setTextColor(tokens.buttonText)
      setBackgroundColor(bgColor)
      setOnClickListener { onPress() }
      setAllCaps(false)
    }
  }

  private fun roundedBackground(bgColor: Int, borderColor: Int, radius: Float): android.graphics.drawable.GradientDrawable {
    return android.graphics.drawable.GradientDrawable().apply {
      shape = android.graphics.drawable.GradientDrawable.RECTANGLE
      cornerRadius = radius
      setColor(bgColor)
      setStroke(dp(1), borderColor)
    }
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
      val fatal = fatalOverlayView
      if (fatal != null) {
        forceLayoutInRoot(root, fatal)
      }
      val warning = warningToastView
      if (warning != null) {
        forceLayoutInRoot(root, warning)
      }
    }
    root.addOnLayoutChangeListener(listener)
    rootLayoutListener = listener
  }

  private fun forceLayoutInRoot(root: ZynthRootView, overlay: View) {
    root.post {
      val width = if (root.width > 0) root.width else root.resources.displayMetrics.widthPixels
      val height = if (root.height > 0) root.height else root.resources.displayMetrics.heightPixels
      if (width <= 0 || height <= 0) return@post
      val widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
      val heightSpec = View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
      overlay.measure(widthSpec, heightSpec)
      overlay.layout(0, 0, width, height)
      overlay.requestLayout()
      overlay.invalidate()
    }
  }
}
