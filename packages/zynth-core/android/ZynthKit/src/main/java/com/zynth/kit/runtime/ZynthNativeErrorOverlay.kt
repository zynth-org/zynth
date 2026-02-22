package com.zynth.kit.runtime

import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.View.OnLayoutChangeListener
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.zynth.kit.core.ZynthRootView
import java.lang.ref.WeakReference
import org.json.JSONObject

internal object ZynthNativeErrorOverlay {
  private const val TAG = "ZynthNativeOverlay"
  private const val RUNTIME_FONT_ASSET = "fonts/ZynthRuntime.ttf"
  private const val GLYPH_ARROW_RIGHT = "\uea05"
  private const val GLYPH_TERMINAL = "\uea07"
  private const val GLYPH_CLOSE = "\uea0a"
  private const val GLYPH_REFRESH = "\uea0e"

  private val mainHandler = Handler(Looper.getMainLooper())
  private var rootRef: WeakReference<ZynthRootView>? = null
  private var runtimeRef: WeakReference<ZynthRuntime>? = null
  private var fatalOverlayView: View? = null
  private var warningToastView: View? = null
  private var rootLayoutListener: OnLayoutChangeListener? = null
  private var glyphTypeface: Typeface? = null
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

    val kindIsWarning = entry.kind == "warning"
    val accent = if (kindIsWarning) tokens.warning else tokens.error
    val topInset = root.rootWindowInsets?.systemWindowInsetTop ?: statusBarHeight(root)
    val bottomInset = root.rootWindowInsets?.systemWindowInsetBottom ?: 0
    val badgeText = when (entry.kind) {
      "crash" -> "Native Error"
      "warning" -> "Warning"
      else -> "Runtime Error"
    }
    val heroTitle = if (kindIsWarning) {
      "Potential performance issue detected"
    } else {
      "An error has occurred."
    }
    val heroDescription = if (kindIsWarning) {
      "This warning indicates a condition that may lead to unstable behavior."
    } else {
      "A JavaScript exception was detected, preventing further action."
    }

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

    val content = LinearLayout(root.context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(
        dp(tokens.screenPadding),
        topInset + dp(10),
        dp(tokens.screenPadding),
        dp(16),
      )
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      )
    }

    val badge = TextView(root.context).apply {
      text = badgeText.uppercase()
      setTextColor(accent)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
      setTypeface(typeface, Typeface.BOLD)
      setPadding(dp(10), dp(6), dp(10), dp(6))
      background = roundedBackground(withAlpha(accent, 0.14f), withAlpha(accent, 0.32f), dp(999).toFloat())
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    }
    val title = TextView(root.context).apply {
      text = heroTitle
      setTextColor(tokens.title)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      setTypeface(typeface, Typeface.BOLD)
      setPadding(0, dp(12), 0, 0)
    }
    val subtitle = TextView(root.context).apply {
      text = heroDescription
      setTextColor(tokens.body)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      setPadding(0, dp(8), 0, 0)
      maxLines = 4
    }

    val card = LinearLayout(root.context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(tokens.panelPadding), dp(tokens.panelPadding), dp(tokens.panelPadding), dp(tokens.panelPadding))
      background = roundedBackground(tokens.panelBg, tokens.border, dp(22).toFloat())
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(18) }
    }
    val cardTop = LinearLayout(root.context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val iconWrap = FrameLayout(root.context).apply {
      layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
      background = roundedBackground(withAlpha(accent, 0.3f), Color.TRANSPARENT, dp(14).toFloat())
    }
    val terminalIcon = glyphView(root.context, GLYPH_TERMINAL, accent, 22f).apply {
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.WRAP_CONTENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.CENTER,
      )
    }
    iconWrap.addView(terminalIcon)
    val messageWrap = LinearLayout(root.context).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginStart = dp(12)
      }
    }
    val messageTitle = TextView(root.context).apply {
      text = "Message"
      setTextColor(Color.parseColor("#71717A"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      setTypeface(typeface, Typeface.BOLD)
    }
    val messageValue = TextView(root.context).apply {
      text = entry.message
      setTextColor(accent)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      typeface = Typeface.MONOSPACE
      maxLines = 4
      ellipsize = TextUtils.TruncateAt.END
      setPadding(0, dp(4), 0, 0)
    }
    messageWrap.addView(messageTitle)
    messageWrap.addView(messageValue)
    cardTop.addView(iconWrap)
    cardTop.addView(messageWrap)
    card.addView(cardTop)

    val stackLabelRow = LinearLayout(root.context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(16) }
    }
    val stackArrow = glyphView(root.context, GLYPH_ARROW_RIGHT, Color.parseColor("#71717A"), 12f).apply {
      setPadding(0, dp(2), 0, 0)
    }
    val stackLabel = TextView(root.context).apply {
      text = "STACK TRACE"
      setTextColor(Color.parseColor("#71717A"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      setTypeface(typeface, Typeface.BOLD)
      letterSpacing = 0.06f
      setPadding(dp(4), 0, 0, 0)
    }
    stackLabelRow.addView(stackArrow)
    stackLabelRow.addView(stackLabel)

    val stackScroll = ScrollView(root.context).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f,
      ).apply { topMargin = dp(8) }
      setPadding(dp(10), dp(10), dp(10), dp(10))
      background = roundedBackground(withAlpha(tokens.overlayBg, 0.75f), tokens.border, dp(18).toFloat())
      alpha = 1f
      isFillViewport = true
    }
    val stackContent = FrameLayout(root.context).apply {
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      )
    }
    var stackText = buildStackTextView(root.context, styledStackText(entry.stack ?: "No stack trace available."))
    stackContent.addView(stackText)
    stackScroll.addView(stackContent)

    content.addView(badge)
    content.addView(title)
    content.addView(subtitle)
    content.addView(card)
    content.addView(stackLabelRow)
    content.addView(stackScroll)

    val footer = LinearLayout(root.context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(
        dp(tokens.screenPadding),
        dp(12),
        dp(tokens.screenPadding),
        bottomInset + dp(12),
      )
      layoutParams = FrameLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM,
      )
      background = roundedBackground(withAlpha(tokens.overlayBg, 0.98f), tokens.border, 0f)
    }
    val dismissButton = actionButton(root.context, GLYPH_CLOSE, "Dismiss", tokens.neutralButton) {
      removeView(container)
      fatalOverlayView = null
    }
    val reloadButton = actionButton(root.context, GLYPH_REFRESH, "Reload", tokens.dangerButton) {
      runtimeRef?.get()?.requestNativeOverlayReload()
      removeView(container)
      fatalOverlayView = null
    }
    val buttonLp = LinearLayout.LayoutParams(0, dp(tokens.buttonHeight), 1f)
    val buttonLpWithGap = LinearLayout.LayoutParams(0, dp(tokens.buttonHeight), 1f).apply { marginStart = dp(8) }
    footer.addView(dismissButton, buttonLp)
    footer.addView(reloadButton, buttonLpWithGap)

    container.addView(content)
    container.addView(footer)
    removeView(fatalOverlayView)
    root.addView(container)
    fatalOverlayView = container
    forceLayoutInRoot(root, container)
    val initialStack = entry.stack
    if (!initialStack.isNullOrBlank()) {
      ZynthStackSymbolicator.symbolicateStackTrace(initialStack) { symbolicated ->
        if (fatalOverlayView !== container || stackText.parent == null) return@symbolicateStackTrace
        val styled = styledStackText(symbolicated)
        if (stackText.text?.toString() == styled.toString()) return@symbolicateStackTrace
        val previous = stackText
        val replacement = buildStackTextView(root.context, styled).apply { alpha = 0f }
        stackContent.addView(replacement)
        Log.d(
          TAG,
          "symbolicated replacing stack: oldChars=${previous.text.length} newChars=${replacement.text.length}"
        )
        previous.animate().cancel()
        replacement.animate().cancel()
        previous.animate().alpha(0f).setDuration(120L).start()
        replacement.animate()
          .alpha(1f)
          .setDuration(180L)
          .withEndAction {
            if (fatalOverlayView !== container) return@withEndAction
            stackContent.removeView(previous)
            stackText = replacement
            stackContent.requestLayout()
            stackScroll.requestLayout()
            stackScroll.invalidate()
            stackContent.post {
              Log.d(
                TAG,
                "stack layout after swap: lines=${stackText.lineCount} height=${stackText.height} scrollChild=${stackContent.height}"
              )
            }
          }
          .start()
      }
    }
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
          val insetBottom = root.rootWindowInsets?.systemWindowInsetBottom ?: 0
          bottomMargin = insetBottom + dp(12)
        }
        elevation = 99_998f
      }
      val label = TextView(root.context).apply {
        id = View.generateViewId()
        setTextColor(tokens.warning)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        setTypeface(typeface, Typeface.BOLD)
      }
      val close = actionButton(root.context, GLYPH_CLOSE, "Close", tokens.neutralButton) {
        removeView(warningToastView)
        warningToastView = null
        warningCount = 0
        warningMessage = ""
      }
      close.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40))
      container.addView(label, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
      container.addView(close)
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

  private fun actionButton(
    context: android.content.Context,
    glyph: String,
    label: String,
    bgColor: Int,
    onPress: () -> Unit,
  ): LinearLayout {
    return LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      setPadding(dp(12), 0, dp(12), 0)
      background = roundedBackground(bgColor, Color.TRANSPARENT, dp(16).toFloat())
      isClickable = true
      isFocusable = true
      setOnClickListener { onPress() }
      addView(glyphView(context, glyph, tokens.buttonText, 18f))
      addView(TextView(context).apply {
        text = label
        setTextColor(tokens.buttonText)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(dp(6), 0, 0, 0)
      })
    }
  }

  private fun glyphView(
    context: android.content.Context,
    glyph: String,
    color: Int,
    sizeSp: Float,
  ): TextView {
    return TextView(context).apply {
      text = glyph
      setTextColor(color)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      typeface = iconTypeface(context)
      includeFontPadding = false
    }
  }

  private fun iconTypeface(context: android.content.Context): Typeface {
    val cached = glyphTypeface
    if (cached != null) return cached
    val loaded = runCatching {
      Typeface.createFromAsset(context.assets, RUNTIME_FONT_ASSET)
    }.getOrNull() ?: Typeface.DEFAULT
    glyphTypeface = loaded
    return loaded
  }

  private fun withAlpha(color: Int, alpha: Float): Int {
    val a = (alpha.coerceIn(0f, 1f) * 255f).toInt()
    return (color and 0x00FFFFFF) or (a shl 24)
  }

  private fun styledStackText(stack: String): SpannableString {
    val display = prepareDisplayStack(stack)
    val spannable = SpannableString(display)
    val firstLineEnd = display.indexOf('\n').let { if (it == -1) display.length else it }
    if (firstLineEnd > 0) {
      spannable.setSpan(
        ForegroundColorSpan(tokens.title),
        0,
        firstLineEnd,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
      )
    }
    return spannable
  }

  private fun buildStackTextView(
    context: android.content.Context,
    text: SpannableString,
  ): TextView {
    return TextView(context).apply {
      setTextColor(tokens.body)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      typeface = Typeface.MONOSPACE
      setLineSpacing(0f, 1.2f)
      setHorizontallyScrolling(false)
      isVerticalScrollBarEnabled = false
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      )
      this.text = text
    }
  }

  private fun prepareDisplayStack(stack: String): String {
    val text = stack.ifBlank { "No stack trace available." }
    val lines = text.split('\n')
    if (lines.isEmpty()) return text
    val output = ArrayList<String>(lines.size)
    for ((index, line) in lines.withIndex()) {
      if (index == 0) {
        output += line
      } else {
        output += "  $line"
      }
    }
    return output.joinToString("\n")
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
