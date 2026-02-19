package com.zynth.components.button

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.TouchDelegate
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.google.android.material.button.MaterialButton
import com.google.android.material.color.MaterialColors
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt

private const val LONG_PRESS_TIMEOUT_MS = 500L
private const val DEFAULT_PRESS_RETENTION_DP = 12f
private const val DEFAULT_MIN_TOUCH_DP = 44f

/**
 * A native Material 3 button container for Zynth.
 *
 * This is a FrameLayout that contains:
 * 1. A MaterialButton at index 0 (handles styling, ripples, and touch)
 * 2. Child Views from JS (rendered on top, with touch pass-through)
 *
 * Child Views have touch events disabled (like pointerEvents="none") so all
 * touch interactions go to the underlying MaterialButton.
 */
class ZynthButtonView(context: Context) : FrameLayout(context) {

  interface Listener {
    fun onPressIn(nodeId: Int)
    fun onPressOut(nodeId: Int, cancelled: Boolean)
    fun onPress(nodeId: Int)
    fun onLongPress(nodeId: Int, durationMs: Long)
    fun onFocus(nodeId: Int)
    fun onBlur(nodeId: Int)
    fun onKeyEvent(nodeId: Int, phase: String, key: String?)
  }

  var nodeId: Int = -1
  var listener: Listener? = null

  // The internal MaterialButton that handles all styling and touch feedback
  private val materialButton: MaterialButton

  private val density = resources.displayMetrics.density
  private val mainHandler = Handler(Looper.getMainLooper())

  // State
  private var disabled = false
  private var loading = false
  private var preventFocusOnPress = false
  private var hasLongPressHandler = false
  private var hapticsMode: String = "none"
  private var lastCommandSeq: Long = -1L
  private var isReady = false

  // Configuration
  private var currentVariant: String = "filled"
  private var currentTone: String = "primary"
  private var currentSize: String = "medium"
  private var currentRounded: String = "md"
  private var currentBaseColor: Int? = null
  private var isIconOnly: Boolean = false

  // Long press tracking
  private var longPressRunnable: Runnable? = null
  private var pressStartTimeMs: Long = 0L
  private var longPressTriggered = false
  private var pressRetentionOffsetPx = DEFAULT_PRESS_RETENTION_DP * density
  private var hitSlop: Rect? = null

  fun setShowLoadingSpinner(show: Boolean) {
    // No-op
  }

  init {
    // Ensure children can render outside bounds when their overflow is visible
    clipChildren = false
    clipToPadding = false
    
    // Create the MaterialButton
    materialButton = MaterialButton(context).apply {
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
      isClickable = true
      isFocusable = true
      // IMPORTANT: Don't set isFocusableInTouchMode = true, as it causes the first
      // tap to focus instead of click. Keep it false for proper touch-first UX.
      isFocusableInTouchMode = false
      importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
      isAllCaps = false
      insetTop = 0
      insetBottom = 0
      iconGravity = MaterialButton.ICON_GRAVITY_TEXT_START
      iconPadding = (8 * density).roundToInt()
    }

    // Add the button as the first child (background layer)
    super.addView(materialButton, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

    // Disable ZynthButtonView's own touch handling to let MaterialButton handle it naturally
    isClickable = false
    isFocusable = false

    // Set up click listener on the MaterialButton
    materialButton.setOnClickListener {
      if (!shouldHandleInteraction() || nodeId < 0) return@setOnClickListener
      if (!longPressTriggered) {
        triggerHaptics()
        listener?.onPress(nodeId)
      }
    }

    // Set up touch listener for press tracking
    materialButton.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          if (shouldHandleInteraction() && nodeId >= 0) {
            longPressTriggered = false
            pressStartTimeMs = SystemClock.uptimeMillis()
            listener?.onPressIn(nodeId)
            scheduleLongPress()
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          if (nodeId >= 0) {
            cancelLongPressTimer()
            listener?.onPressOut(nodeId, event.action == MotionEvent.ACTION_CANCEL)
          }
        }
      }
      false // Don't consume, let MaterialButton handle the rest (ripples, etc)
    }

    // Long click for onLongPress
    materialButton.setOnLongClickListener {
      if (!shouldHandleInteraction() || nodeId < 0 || !hasLongPressHandler) {
        return@setOnLongClickListener false
      }
      longPressTriggered = true
      val duration = SystemClock.uptimeMillis() - pressStartTimeMs
      listener?.onLongPress(nodeId, max(duration, LONG_PRESS_TIMEOUT_MS))
      true
    }

    // Focus change listener
    materialButton.setOnFocusChangeListener { _, hasFocus ->
      if (nodeId < 0) return@setOnFocusChangeListener
      if (hasFocus) {
        listener?.onFocus(nodeId)
      } else {
        listener?.onBlur(nodeId)
      }
    }

    // Apply initial Material 3 style
    applyMaterialStyle()
    updateReadyVisibility()
  }

  /**
   * Override addView to ensure child Views (from JS) are added after the MaterialButton
   * and have touch events disabled so they don't intercept button touches.
   */
  override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
    if (child === materialButton) {
      // MaterialButton is always at index 0
      super.addView(child, 0, params)
    } else {
      // All other children go on top and don't intercept touches
      child?.let {
        // Disable touch on child views - they're just visual
        disableTouchRecursively(it)
      }
      // Add after the MaterialButton (index 0), so at index 1 or higher
      val safeIndex = if (index <= 0) childCount else index.coerceAtMost(childCount)
      super.addView(child, safeIndex, params)
    }
  }

  /**
   * Recursively disable touch events on a view and all its children.
   * This implements the "pointerEvents: none" behavior.
   */
  private fun disableTouchRecursively(view: View) {
    view.isClickable = false
    view.isFocusable = false
    view.isLongClickable = false
    // This is the key - makes the view not intercept touch events
    view.setOnTouchListener { _, _ -> false }
    
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        disableTouchRecursively(view.getChildAt(i))
      }
    }
  }



  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // Yoga drives layout via explicit setFrame, bypassing onMeasure.
    // We must manually measure the internal MaterialButton to match our size.
    val width = right - left
    val height = bottom - top
    if (width > 0 && height > 0) {
      val wSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
      val hSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
      materialButton.measure(wSpec, hSpec)
    }
    super.onLayout(changed, left, top, right, bottom)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyHitSlop()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    clearHitSlop()
    cancelLongPressTimer()
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Material 3 Style Configuration
  // ─────────────────────────────────────────────────────────────────────────────

  private fun applyMaterialStyle() {
    // Apply size FIRST (needed for pill corner radius calculation)
    applySize()

    // Apply variant-based styling using MaterialButton's native APIs
    when (currentVariant.lowercase()) {
      "filled" -> applyFilledStyle()
      "tonal", "tinted" -> applyTonalStyle()
      "outline", "outlined" -> applyOutlinedStyle()
      "elevated" -> applyElevatedStyle()
      "text", "ghost", "plain", "link" -> applyTextStyle()
      else -> applyFilledStyle()
    }

    // Apply corner radius
    applyCornerRadius()

    // Apply base color override if set
    currentBaseColor?.let { applyBaseColorOverride(it) }
  }

  private fun applyFilledStyle() {
    val isDestructive = currentTone.lowercase() == "danger"
    val bgColor = if (isDestructive)
      getThemeColor(com.google.android.material.R.attr.colorError)
    else
      getThemeColor(com.google.android.material.R.attr.colorPrimary)
    val fgColor = if (isDestructive)
      getThemeColor(com.google.android.material.R.attr.colorOnError)
    else
      getThemeColor(com.google.android.material.R.attr.colorOnPrimary)

    updateButtonColors(bgColor, fgColor)
    materialButton.strokeWidth = 0
    materialButton.strokeColor = null
    materialButton.elevation = 0f
    materialButton.stateListAnimator = null
  }

  private fun applyTonalStyle() {
    val bgColor = getThemeColor(com.google.android.material.R.attr.colorSecondaryContainer)
    val fgColor = getThemeColor(com.google.android.material.R.attr.colorOnSecondaryContainer)

    updateButtonColors(bgColor, fgColor)
    materialButton.strokeWidth = 0
    materialButton.strokeColor = null
    materialButton.elevation = 0f
    materialButton.stateListAnimator = null
  }

  private fun applyOutlinedStyle() {
    val fgColor = getThemeColor(com.google.android.material.R.attr.colorPrimary)
    val outlineColor = getThemeColor(com.google.android.material.R.attr.colorOutline)

    materialButton.backgroundTintList = ColorStateList.valueOf(Color.TRANSPARENT)
    materialButton.setTextColor(fgColor)
    materialButton.iconTint = ColorStateList.valueOf(fgColor)
    materialButton.strokeWidth = (1 * density).roundToInt()
    materialButton.strokeColor = ColorStateList.valueOf(outlineColor)
    materialButton.elevation = 0f
    materialButton.stateListAnimator = null
    materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
  }

  private fun applyElevatedStyle() {
    val bgColor = getThemeColor(com.google.android.material.R.attr.colorSurfaceContainerLow)
    val fgColor = getThemeColor(com.google.android.material.R.attr.colorPrimary)

    materialButton.backgroundTintList = ColorStateList.valueOf(bgColor)
    materialButton.setTextColor(fgColor)
    materialButton.iconTint = ColorStateList.valueOf(fgColor)
    materialButton.strokeWidth = 0
    materialButton.strokeColor = null
    materialButton.elevation = 1 * density
    materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
  }

  private fun applyTextStyle() {
    val fgColor = getThemeColor(com.google.android.material.R.attr.colorPrimary)

    materialButton.backgroundTintList = ColorStateList.valueOf(Color.TRANSPARENT)
    materialButton.setTextColor(fgColor)
    materialButton.iconTint = ColorStateList.valueOf(fgColor)
    materialButton.strokeWidth = 0
    materialButton.strokeColor = null
    materialButton.elevation = 0f
    materialButton.stateListAnimator = null
    materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
  }

  private fun applySize() {
    val (minHeightDp, paddingHDp, paddingVDp, textSizeSp) = when (currentSize.lowercase()) {
      "mini", "xs" -> SizeMetrics(32f, 16f, 6f, 12f)
      "small", "sm" -> SizeMetrics(36f, 20f, 8f, 14f)
      "large", "lg" -> SizeMetrics(48f, 28f, 12f, 16f)
      "xl" -> SizeMetrics(56f, 32f, 14f, 18f)
      else -> SizeMetrics(40f, 24f, 10f, 14f) // medium (M3 default)
    }

    val heightPx = (minHeightDp * density).roundToInt()
    
    if (isIconOnly) {
      // Icon-only buttons should be square with equal padding
      minimumHeight = heightPx
      minimumWidth = heightPx
      materialButton.minimumHeight = heightPx
      materialButton.minimumWidth = heightPx
      materialButton.minHeight = heightPx
      materialButton.minWidth = heightPx
      val iconPadding = (paddingVDp * density).roundToInt()
      materialButton.setPadding(iconPadding, iconPadding, iconPadding, iconPadding)
    } else {
      minimumHeight = heightPx
      materialButton.minimumHeight = heightPx
      materialButton.minHeight = heightPx
      materialButton.setPadding(
        (paddingHDp * density).roundToInt(),
        (paddingVDp * density).roundToInt(),
        (paddingHDp * density).roundToInt(),
        (paddingVDp * density).roundToInt()
      )
    }
    materialButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp)
  }

  private data class SizeMetrics(
    val minHeight: Float,
    val paddingH: Float,
    val paddingV: Float,
    val textSize: Float
  )

  private fun applyCornerRadius() {
    materialButton.cornerRadius = currentCornerRadiusPx().roundToInt()
  }

  private fun currentCornerRadiusDp(): Float {
    return when (currentRounded.lowercase()) {
      "none" -> 0f
      "sm" -> 4f
      "lg" -> 16f
      "pill", "full" -> 100f
      else -> 8f // md
    }
  }

  private fun currentCornerRadiusPx(): Float {
    return when (currentRounded.lowercase()) {
      "pill", "full" -> materialButton.minHeight / 2f
      else -> currentCornerRadiusDp() * density
    }
  }

  private fun applyBaseColorOverride(color: Int) {
    when (currentVariant.lowercase()) {
      "filled" -> {
        materialButton.backgroundTintList = ColorStateList.valueOf(color)
        val textColor = if (isColorDark(color)) Color.WHITE else Color.BLACK
        materialButton.setTextColor(textColor)
        materialButton.iconTint = ColorStateList.valueOf(textColor)
        materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(textColor, 0.16f))
      }
      else -> {
        materialButton.setTextColor(color)
        materialButton.iconTint = ColorStateList.valueOf(color)
        if (currentVariant.lowercase() in listOf("tinted", "outline", "outlined")) {
          materialButton.strokeColor = ColorStateList.valueOf(color)
        }
        materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(color, 0.16f))
      }
    }
  }

  private fun applyToneColor() {
    if (currentBaseColor != null) return
    if (currentTone.lowercase() == "primary") return

    when (currentTone.lowercase()) {
      "danger" -> {
        when (currentVariant.lowercase()) {
          "filled" -> {
            val bgColor = getThemeColor(com.google.android.material.R.attr.colorError)
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorOnError)
            materialButton.backgroundTintList = ColorStateList.valueOf(bgColor)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
          "tonal", "tinted" -> {
            val bgColor = getThemeColor(com.google.android.material.R.attr.colorErrorContainer)
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorOnErrorContainer)
            materialButton.backgroundTintList = ColorStateList.valueOf(bgColor)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
          else -> {
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorError)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            if (currentVariant.lowercase() in listOf("outline", "outlined")) {
              materialButton.strokeColor = ColorStateList.valueOf(fgColor)
            }
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
        }
      }
      "secondary" -> {
        when (currentVariant.lowercase()) {
          "filled" -> {
            val bgColor = getThemeColor(com.google.android.material.R.attr.colorSecondary)
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorOnSecondary)
            materialButton.backgroundTintList = ColorStateList.valueOf(bgColor)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
          else -> {
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorSecondary)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            if (currentVariant.lowercase() in listOf("outline", "outlined")) {
              materialButton.strokeColor = ColorStateList.valueOf(fgColor)
            }
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
        }
      }
      "tertiary", "success", "warning" -> {
        when (currentVariant.lowercase()) {
          "filled" -> {
            val bgColor = getThemeColor(com.google.android.material.R.attr.colorTertiary)
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorOnTertiary)
            materialButton.backgroundTintList = ColorStateList.valueOf(bgColor)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
          "tonal", "tinted" -> {
            val bgColor = getThemeColor(com.google.android.material.R.attr.colorTertiaryContainer)
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorOnTertiaryContainer)
            materialButton.backgroundTintList = ColorStateList.valueOf(bgColor)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
          else -> {
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorTertiary)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            if (currentVariant.lowercase() in listOf("outline", "outlined")) {
              materialButton.strokeColor = ColorStateList.valueOf(fgColor)
            }
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
        }
      }
      "neutral" -> {
        when (currentVariant.lowercase()) {
          "filled" -> {
            val bgColor = getThemeColor(com.google.android.material.R.attr.colorOnSurface)
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorSurface)
            materialButton.backgroundTintList = ColorStateList.valueOf(bgColor)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
          else -> {
            val fgColor = getThemeColor(com.google.android.material.R.attr.colorOnSurfaceVariant)
            materialButton.setTextColor(fgColor)
            materialButton.iconTint = ColorStateList.valueOf(fgColor)
            if (currentVariant.lowercase() in listOf("outline", "outlined")) {
              materialButton.strokeColor = ColorStateList.valueOf(fgColor)
            }
            materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
          }
        }
      }
    }
  }

  private fun getThemeColor(attr: Int): Int {
    val color = MaterialColors.getColor(materialButton, attr, Color.MAGENTA)
    if (color == Color.MAGENTA) {
      return when (attr) {
        com.google.android.material.R.attr.colorPrimary -> Color.parseColor("#6750A4")
        com.google.android.material.R.attr.colorOnPrimary -> Color.WHITE
        com.google.android.material.R.attr.colorPrimaryContainer -> Color.parseColor("#EADDFF")
        com.google.android.material.R.attr.colorOnPrimaryContainer -> Color.parseColor("#21005D")
        com.google.android.material.R.attr.colorSecondary -> Color.parseColor("#625B71")
        com.google.android.material.R.attr.colorOnSecondary -> Color.WHITE
        com.google.android.material.R.attr.colorSecondaryContainer -> Color.parseColor("#E8DEF8")
        com.google.android.material.R.attr.colorOnSecondaryContainer -> Color.parseColor("#1D192B")
        com.google.android.material.R.attr.colorTertiary -> Color.parseColor("#7D5260")
        com.google.android.material.R.attr.colorOnTertiary -> Color.WHITE
        com.google.android.material.R.attr.colorTertiaryContainer -> Color.parseColor("#FFD8E4")
        com.google.android.material.R.attr.colorOnTertiaryContainer -> Color.parseColor("#31111D")
        com.google.android.material.R.attr.colorError -> Color.parseColor("#B3261E")
        com.google.android.material.R.attr.colorOnError -> Color.WHITE
        com.google.android.material.R.attr.colorErrorContainer -> Color.parseColor("#F9DEDC")
        com.google.android.material.R.attr.colorOnErrorContainer -> Color.parseColor("#410E0B")
        com.google.android.material.R.attr.colorSurface -> Color.parseColor("#FEF7FF")
        com.google.android.material.R.attr.colorOnSurface -> Color.parseColor("#1D1B20")
        com.google.android.material.R.attr.colorOnSurfaceVariant -> Color.parseColor("#49454F")
        com.google.android.material.R.attr.colorSurfaceContainerLow -> Color.parseColor("#F7F2FA")
        com.google.android.material.R.attr.colorSurfaceContainer -> Color.parseColor("#F3EDF7")
        com.google.android.material.R.attr.colorSurfaceContainerHigh -> Color.parseColor("#ECE6F0")
        com.google.android.material.R.attr.colorOutline -> Color.parseColor("#79747E")
        com.google.android.material.R.attr.colorOutlineVariant -> Color.parseColor("#CAC4D0")
        com.google.android.material.R.attr.colorControlHighlight -> Color.parseColor("#1F6750A4")
        else -> Color.GRAY
      }
    }
    return color
  }

  private fun adjustAlpha(color: Int, factor: Float): Int {
    val alpha = (Color.alpha(color) * factor).roundToInt().coerceIn(0, 255)
    return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
  }

  private fun isColorDark(color: Int): Boolean {
    val darkness = 1 - (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255
    return darkness >= 0.5
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Configuration Methods
  // ─────────────────────────────────────────────────────────────────────────────

  fun setVariant(variant: String?) {
    val next = variant ?: "filled"
    if (currentVariant == next) return
    currentVariant = next
    applyMaterialStyle()
    applyToneColor()
  }

  fun setTone(tone: String?) {
    val next = tone ?: "primary"
    if (currentTone == next) return
    currentTone = next
    applyMaterialStyle()
    applyToneColor()
  }

  fun setButtonSize(size: String?) {
    val next = size ?: "medium"
    if (currentSize == next) return
    currentSize = next
    applySize()
  }

  fun setRounded(rounded: String?) {
    val next = rounded ?: "md"
    if (currentRounded == next) return
    currentRounded = next
    applyCornerRadius()
  }

  fun setBaseColor(color: Int?) {
    if (currentBaseColor == color) return
    currentBaseColor = color
    if (color != null) {
      applyBaseColorOverride(color)
    } else {
      applyMaterialStyle()
      applyToneColor()
    }
  }

  fun setTitle(title: String?) {
    materialButton.text = title
  }

  fun setIconOnly(value: Boolean) {
    if (isIconOnly != value) {
      isIconOnly = value
      applyMaterialStyle()
    }
  }

  fun setDisabled(value: Boolean) {
    disabled = value
    applyEnabledState()
  }

  fun setLoading(value: Boolean) {
    loading = value
    applyEnabledState()
  }

  fun setLoadingAriaLabel(label: String?) {
    // No-op
  }

  fun setPressRetentionOffset(value: Number?) {
    pressRetentionOffsetPx = max(0f, (value?.toFloat() ?: DEFAULT_PRESS_RETENTION_DP) * density)
  }

  fun setHitSlop(value: JSONObject?) {
    if (value == null) {
      hitSlop = null
      clearHitSlop()
      return
    }
    val top = value.optDouble("top", 0.0).toFloat()
    val left = value.optDouble("left", 0.0).toFloat()
    val bottom = value.optDouble("bottom", 0.0).toFloat()
    val right = value.optDouble("right", 0.0).toFloat()
    val rect = Rect(
      (left * density).roundToInt(),
      (top * density).roundToInt(),
      (right * density).roundToInt(),
      (bottom * density).roundToInt(),
    )
    hitSlop = rect
    if (isAttachedToWindow) {
      applyHitSlop()
    }
  }

  fun setMinimumTouchSize(value: JSONObject?) {
    val w: Float
    val h: Float
    if (value == null) {
      w = DEFAULT_MIN_TOUCH_DP * density
      h = DEFAULT_MIN_TOUCH_DP * density
    } else {
      w = max(0f, value.optDouble("width", DEFAULT_MIN_TOUCH_DP.toDouble()).toFloat() * density)
      h = max(0f, value.optDouble("height", DEFAULT_MIN_TOUCH_DP.toDouble()).toFloat() * density)
    }
    minimumWidth = w.roundToInt()
    minimumHeight = h.roundToInt()
    materialButton.minimumWidth = w.roundToInt()
    materialButton.minimumHeight = h.roundToInt()
    requestLayout()
  }

  fun setPreventFocusOnPress(value: Boolean) {
    preventFocusOnPress = value
  }

  fun setHapticsMode(value: String?) {
    hapticsMode = value ?: "none"
  }

  fun setHasLongPressHandler(hasHandler: Boolean) {
    hasLongPressHandler = hasHandler
    materialButton.isLongClickable = hasHandler
  }

  fun setPressEffect(effect: String?) {
    if (effect?.lowercase() == "none") {
      materialButton.rippleColor = ColorStateList.valueOf(Color.TRANSPARENT)
    } else {
      val rippleColorValue = getThemeColor(com.google.android.material.R.attr.colorControlHighlight)
      materialButton.rippleColor = ColorStateList.valueOf(rippleColorValue)
    }
  }

  fun handleCommand(command: JSONObject?) {
    if (command == null) return
    val seq = command.optLong("seq", -1L)
    if (seq >= 0 && seq <= lastCommandSeq) {
      return
    }
    if (seq >= 0) lastCommandSeq = seq
    when (command.optString("type", "")) {
      "focus" -> {
        if (!materialButton.hasFocus()) {
          materialButton.requestFocus()
        }
      }
      "blur" -> {
        if (materialButton.hasFocus()) {
          materialButton.clearFocus()
        }
      }
      "click" -> {
        if (!shouldHandleInteraction()) return
        listener?.onPressIn(nodeId)
        triggerHaptics()
        listener?.onPress(nodeId)
        listener?.onPressOut(nodeId, false)
      }
    }
  }

  /**
   * Resets the button to its default state (for view recycling).
   */
  fun reset() {
    disabled = false
    loading = false
    preventFocusOnPress = false
    hasLongPressHandler = false
    hapticsMode = "none"
    lastCommandSeq = -1L
    currentVariant = "filled"
    currentTone = "primary"
    currentSize = "medium"
    currentRounded = "md"
    currentBaseColor = null
    isIconOnly = false
    isReady = false
    pressRetentionOffsetPx = DEFAULT_PRESS_RETENTION_DP * density
    hitSlop = null
    
    materialButton.text = null
    materialButton.isEnabled = true
    alpha = 1f
    materialButton.isLongClickable = false
    
    // Remove all child views except the MaterialButton
    for (i in childCount - 1 downTo 1) {
      removeViewAt(i)
    }
    
    clearHitSlop()
    cancelLongPressTimer()
    applyMaterialStyle()
    updateReadyVisibility()
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Internal Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private fun shouldHandleInteraction(): Boolean {
    return !disabled && !loading
  }

  private fun triggerHaptics() {
    val mode = hapticsMode.lowercase()
    if (mode == "none") return
    val constant = when (mode) {
      "light" -> HapticFeedbackConstants.VIRTUAL_KEY
      "medium" -> HapticFeedbackConstants.KEYBOARD_TAP
      "heavy" -> HapticFeedbackConstants.LONG_PRESS
      "success" -> HapticFeedbackConstants.CONTEXT_CLICK
      "warning" -> HapticFeedbackConstants.TEXT_HANDLE_MOVE
      "error" -> HapticFeedbackConstants.LONG_PRESS
      else -> HapticFeedbackConstants.KEYBOARD_TAP
    }
    performHapticFeedback(constant, HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING)
  }

  private fun scheduleLongPress() {
    if (!hasLongPressHandler) return
    cancelLongPressTimer()
    longPressRunnable = Runnable {
      if (!shouldHandleInteraction()) return@Runnable
      longPressTriggered = true
      val duration = SystemClock.uptimeMillis() - pressStartTimeMs
      listener?.onLongPress(nodeId, max(duration, LONG_PRESS_TIMEOUT_MS))
    }
    pressStartTimeMs = SystemClock.uptimeMillis()
    mainHandler.postDelayed(longPressRunnable!!, LONG_PRESS_TIMEOUT_MS)
  }

  private fun cancelLongPressTimer() {
    longPressRunnable?.let { mainHandler.removeCallbacks(it) }
    longPressRunnable = null
  }

  private fun applyHitSlop() {
    val parentView = parent as? View ?: return
    val slop = hitSlop ?: return
    parentView.post {
      val delegateArea = Rect()
      getHitRect(delegateArea)
      delegateArea.left -= slop.left
      delegateArea.top -= slop.top
      delegateArea.right += slop.right
      delegateArea.bottom += slop.bottom
      parentView.touchDelegate = TouchDelegate(delegateArea, this)
    }
  }

  private fun clearHitSlop() {
    (parent as? View)?.let { parentView ->
      if (parentView.touchDelegate != null) {
        parentView.touchDelegate = null
      }
    }
  }

  fun setReady(ready: Boolean) {
    if (isReady == ready) return
    isReady = ready
    updateReadyVisibility()
  }

  private fun updateReadyVisibility() {
    visibility = if (isReady) View.VISIBLE else View.INVISIBLE
    materialButton.visibility = if (isReady) View.VISIBLE else View.INVISIBLE
    applyEnabledState()
  }

  private fun applyEnabledState() {
    val enabled = isReady && !disabled && !loading
    materialButton.isEnabled = enabled
    
    // Ensure the button doesn't intercept or show feedback when disabled
    materialButton.isClickable = enabled
    materialButton.isFocusable = enabled
    
    // Visual feedback for disabled state
    alpha = if (enabled) 1f else 0.6f
    
    // Force a redraw to update the visual state (ripples should disappear)
    materialButton.invalidate()
  }

  // Helper to create state-aware color lists
  private fun createEnabledStateList(enabledColor: Int): ColorStateList {
    val states = arrayOf(
      intArrayOf(-android.R.attr.state_enabled),
      intArrayOf()
    )
    val disabledColor = adjustAlpha(enabledColor, 0.38f)
    val colors = intArrayOf(disabledColor, enabledColor)
    return ColorStateList(states, colors)
  }

  // Update styling methods to use state lists...
  private fun updateButtonColors(bgColor: Int, fgColor: Int) {
    val disabledBg = getThemeColor(com.google.android.material.R.attr.colorOnSurface)
    val bgStates = arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf())
    val bgColors = intArrayOf(adjustAlpha(disabledBg, 0.12f), bgColor)
    materialButton.backgroundTintList = ColorStateList(bgStates, bgColors)

    val fgStates = arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf())
    val fgColors = intArrayOf(adjustAlpha(disabledBg, 0.38f), fgColor)
    val fgList = ColorStateList(fgStates, fgColors)
    materialButton.setTextColor(fgList)
    materialButton.iconTint = fgList
    materialButton.rippleColor = ColorStateList.valueOf(adjustAlpha(fgColor, 0.16f))
  }
}
