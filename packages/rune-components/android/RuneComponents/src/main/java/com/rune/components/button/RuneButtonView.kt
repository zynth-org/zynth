package com.rune.components.button

import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.TouchDelegate
import android.view.View
import android.widget.FrameLayout
import androidx.core.content.res.use
import org.json.JSONObject
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

private const val LONG_PRESS_TIMEOUT_MS = 500L
private const val DEFAULT_PRESS_RETENTION_DP = 12f
private const val DEFAULT_MIN_TOUCH_DP = 44f
private const val HIGHLIGHT_ANIMATION_MS = 200L
private const val ASYNC_PRESS_DELAY_MS = 50L

class RuneButtonView(context: Context) : FrameLayout(context) {

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

  private val density = resources.displayMetrics.density
  private val mainHandler = Handler(Looper.getMainLooper())

  private var disabled = false
  private var loading = false
  private var preventFocusOnPress = false
  private var pressRetentionOffsetPx = DEFAULT_PRESS_RETENTION_DP * density
  private var hasLongPressHandler = false
  private var hapticsMode: String = "none"
  private var pressEffect: String = "ripple"
  private var lastCommandSeq: Long = -1L

  private var longPressRunnable: Runnable? = null
  private var pressedDown = false
  private var longPressTriggered = false
  private var pressStartTimeMs: Long = 0L
  private var downX = 0f
  private var downY = 0f
  private var hitSlop: Rect? = null

  init {
    isClickable = true
    isFocusable = true
    isFocusableInTouchMode = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    clipToPadding = false
    clipChildren = false
    requestLayout()
    updatePressEffect()
    setOnFocusChangeListener { _, hasFocus ->
      if (nodeId < 0) return@setOnFocusChangeListener
      if (hasFocus) {
        listener?.onFocus(nodeId)
      } else {
        listener?.onBlur(nodeId)
      }
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyHitSlop()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    clearHitSlop()
  }

  private fun updatePressEffect() {
    if (pressEffect.equals("none", ignoreCase = true)) {
      foreground = null
      return
    }
    if (pressEffect.equals("highlight", ignoreCase = true)) {
      // Highlight handled in code by manipulating pressed state alpha.
      foreground = null
      return
    }
    if (pressEffect.equals("ripple", ignoreCase = true)) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val attrs = intArrayOf(android.R.attr.selectableItemBackgroundBorderless)
        context.obtainStyledAttributes(attrs).use { ta ->
          foreground = ta.getDrawable(0)
        }
      } else {
        val attrs = intArrayOf(android.R.attr.selectableItemBackground)
        context.obtainStyledAttributes(attrs).use { ta ->
          foreground = ta.getDrawable(0)
        }
      }
    }
  }

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
    cancelLongPress()
    longPressRunnable = Runnable {
      if (!pressedDown || !shouldHandleInteraction()) return@Runnable
      longPressTriggered = true
      val duration = SystemClock.uptimeMillis() - pressStartTimeMs
      listener?.onLongPress(nodeId, max(duration, LONG_PRESS_TIMEOUT_MS))
    }
    pressStartTimeMs = SystemClock.uptimeMillis()
    mainHandler.postDelayed(longPressRunnable!!, LONG_PRESS_TIMEOUT_MS)
  }

  override fun cancelLongPress() {
    super.cancelLongPress()
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

  private fun updateVisualState(animated: Boolean) {
    val targetAlpha = when {
      !isEnabled -> 0.5f
      pressedDown && pressEffect.equals("highlight", ignoreCase = true) -> 0.85f
      else -> 1f
    }

    if (animated) {
      animate().alpha(targetAlpha).setDuration(HIGHLIGHT_ANIMATION_MS).start()
    } else {
      // Cancel any ongoing animation and set the alpha directly
      animate().cancel()
      alpha = targetAlpha
    }
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!shouldHandleInteraction() || nodeId < 0) {
      return super.onTouchEvent(event)
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        pressedDown = true
        longPressTriggered = false
        downX = event.x
        downY = event.y
        if (!preventFocusOnPress) {
          requestFocus()
        }
        isPressed = true
        updateVisualState(animated = false)
        listener?.onPressIn(nodeId)
        scheduleLongPress()
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (!pressedDown) return super.onTouchEvent(event)
        val dx = event.x - downX
        val dy = event.y - downY
        val distance = hypot(dx.toDouble(), dy.toDouble()).toFloat()
        if (pressRetentionOffsetPx > 0 && distance > pressRetentionOffsetPx) {
          cancelCurrentPress(true)
        }
        return true
      }
      MotionEvent.ACTION_UP -> {
        if (!pressedDown) return super.onTouchEvent(event)
        val wasLongPress = longPressTriggered
        cancelLongPress()
        pressedDown = false
        isPressed = false
        mainHandler.postDelayed({
          if (!pressedDown && !loading) {
            updateVisualState(animated = true)
          }
        }, ASYNC_PRESS_DELAY_MS)
        if (!wasLongPress) {
          triggerHaptics()
          listener?.onPress(nodeId)
          performClick()
        }
        listener?.onPressOut(nodeId, false)
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelCurrentPress(true)
        return true
      }
    }
    return super.onTouchEvent(event)
  }

  private fun cancelCurrentPress(cancelled: Boolean) {
    if (!pressedDown) return
    cancelLongPress()
    pressedDown = false
    longPressTriggered = false
    isPressed = false
    mainHandler.postDelayed({
      if (!pressedDown && !loading) {
        updateVisualState(animated = true)
      }
    }, ASYNC_PRESS_DELAY_MS)
    listener?.onPressOut(nodeId, cancelled)
  }

  override fun performClick(): Boolean {
    return super.performClick()
  }

  override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent): Boolean {
    if (!shouldHandleInteraction()) return super.onKeyDown(keyCode, event)
    val keyName = android.view.KeyEvent.keyCodeToString(keyCode).removePrefix("KEYCODE_")
    listener?.onKeyEvent(nodeId, "onKeyDown", keyName)
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: android.view.KeyEvent): Boolean {
    if (!shouldHandleInteraction()) return super.onKeyUp(keyCode, event)
    val keyName = android.view.KeyEvent.keyCodeToString(keyCode).removePrefix("KEYCODE_")
    listener?.onKeyEvent(nodeId, "onKeyUp", keyName)
    return super.onKeyUp(keyCode, event)
  }

  fun setDisabled(value: Boolean) {
    disabled = value
    isEnabled = !value && !loading
    updateVisualState(animated = true)
  }

  fun setLoading(value: Boolean) {
    loading = value
    isEnabled = !(value || disabled)
    updateVisualState(animated = true)
  }

  fun setPressEffect(effect: String?) {
    pressEffect = effect ?: "ripple"
    updatePressEffect()
    updateVisualState(animated = false)
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
        if (!hasFocus()) {
          requestFocus()
        }
      }
      "blur" -> {
        if (hasFocus()) {
          clearFocus()
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
}
