package com.rune.kit.core

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Rect
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.TouchDelegate
import android.view.View
import android.widget.FrameLayout
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import org.json.JSONObject

private const val DEFAULT_PRESS_RETENTION_DP = 20f
private const val DEFAULT_LONG_PRESS_MS = 500L
private const val DEFAULT_DOUBLE_PRESS_WINDOW_MS = 250L
private const val PRESS_FADE_ANIMATION_MS = 120L

class RunePressableView(context: Context) : FrameLayout(context) {

  interface Listener {
    fun onPressablePressIn(nodeId: Int, payload: JSONObject)
    fun onPressablePressOut(nodeId: Int, payload: JSONObject, cancelled: Boolean)
    fun onPressablePress(nodeId: Int, payload: JSONObject)
    fun onPressableLongPress(nodeId: Int, durationMs: Long, payload: JSONObject)
    fun onPressableDoublePress(nodeId: Int, payload: JSONObject)
    fun onPressableHover(nodeId: Int, hovering: Boolean)
    fun onPressableFocus(nodeId: Int)
    fun onPressableBlur(nodeId: Int)
    fun onPressableKeyEvent(nodeId: Int, phase: String, payload: JSONObject)
    fun onPressableCancel(nodeId: Int, payload: JSONObject)
  }

  var nodeId: Int = -1
  var listener: Listener? = null

  private val density = resources.displayMetrics.density
  private val mainHandler = Handler(Looper.getMainLooper())

  private var disabled = false
  private var focusableSurface = true
  private var preventFocusOnPress = false
  private var pressEffect: String = "none"
  private var pressRetentionOffsetPx = DEFAULT_PRESS_RETENTION_DP * density
  private var delayPressInMs = 0L
  private var delayPressOutMs = 0L
  private var delayLongPressMs = DEFAULT_LONG_PRESS_MS
  private var allowTouchPropagation = false
  private var cancelOnOutside = true
  private var enableDoublePress = false
  private var doublePressWindowMs = DEFAULT_DOUBLE_PRESS_WINDOW_MS
  private var activateKeys: Set<String> = emptySet()
  private var hitSlop: Rect? = null
  private var pointerEvents: String = "auto"
  private var lastCommandSeq: Long = -1L

  private var pressedDown = false
  private var pressVisible = false
  private var longPressTriggered = false
  private var hasLongPressHandler = false
  private var pressStartTimeMs: Long = 0L
  private var lastPressUpTimeMs: Long = -1L
  private var downX = 0f
  private var downY = 0f
  private var lastDownEvent: MotionEvent? = null

  private var pressInRunnable: Runnable? = null
  private var pressOutRunnable: Runnable? = null
  private var longPressRunnable: Runnable? = null

  init {
    isClickable = true
    isFocusable = true
    isFocusableInTouchMode = true
    clipToPadding = false
    clipChildren = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES

    setOnFocusChangeListener { _, hasFocus ->
      if (nodeId < 0) return@setOnFocusChangeListener
      if (hasFocus) {
        listener?.onPressableFocus(nodeId)
      } else {
        listener?.onPressableBlur(nodeId)
      }
    }
    updatePressVisualState(animated = false)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyHitSlop()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    cancelCurrentPress(true, null)
    clearHitSlop()
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (!hasWindowFocus) {
      cancelCurrentPress(true, null)
    }
  }

  private fun schedulePressIn(event: MotionEvent) {
    cancelPressIn()
    val payload = createPayload(event)
    val runnable = Runnable {
      if (!pressedDown) return@Runnable
      pressVisible = true
      updatePressVisualState(animated = true)
      listener?.onPressablePressIn(nodeId, payload)
    }
    pressInRunnable = runnable
    if (delayPressInMs <= 0L) {
      runnable.run()
    } else {
      mainHandler.postDelayed(runnable, delayPressInMs)
    }
  }

  private fun cancelPressIn() {
    pressInRunnable?.let { mainHandler.removeCallbacks(it) }
    pressInRunnable = null
  }

  private fun schedulePressOut(event: MotionEvent?, cancelled: Boolean) {
    cancelPressOut()
    val payload = createPayload(event)
    val runnable = Runnable {
      listener?.onPressablePressOut(nodeId, payload, cancelled)
      updatePressVisualState(animated = true)
    }
    pressOutRunnable = runnable
    if (delayPressOutMs <= 0L) {
      runnable.run()
    } else {
      mainHandler.postDelayed(runnable, delayPressOutMs)
    }
  }

  private fun cancelPressOut() {
    pressOutRunnable?.let { mainHandler.removeCallbacks(it) }
    pressOutRunnable = null
  }

  private fun scheduleLongPress(event: MotionEvent) {
    cancelLongPress()
    if (delayLongPressMs <= 0L || !hasLongPressHandler) return
    val payload = createPayload(event)
    val start = SystemClock.uptimeMillis()
    longPressRunnable = Runnable {
      if (!pressedDown) return@Runnable
      if (!shouldHandleInteraction()) return@Runnable
      longPressTriggered = true
      val duration = max(SystemClock.uptimeMillis() - start, delayLongPressMs)
      listener?.onPressableLongPress(nodeId, duration, payload)
    }
    pressStartTimeMs = start
    mainHandler.postDelayed(longPressRunnable!!, delayLongPressMs)
  }

  override fun cancelLongPress() {
    super.cancelLongPress()
    longPressRunnable?.let { mainHandler.removeCallbacks(it) }
    longPressRunnable = null
  }

  private fun shouldHandleInteraction(): Boolean {
    if (pointerEvents == "none") return false
    if (pointerEvents == "box-only") return true
    return !disabled
  }

  private fun updatePressVisualState(animated: Boolean) {
    val targetAlpha = when {
      !isEnabled -> 0.5f
      pressVisible && pressEffect.equals("highlight", ignoreCase = true) -> 0.85f
      else -> 1f
    }
    if (animated) {
      animate().alpha(targetAlpha).setDuration(PRESS_FADE_ANIMATION_MS).start()
    } else {
      animate().cancel()
      alpha = targetAlpha
    }
  }

  private fun createPayload(event: MotionEvent?): JSONObject {
    val payload = JSONObject()
    val e = event ?: lastDownEvent
    if (e != null) {
      payload.put("x", e.x.toDouble())
      payload.put("y", e.y.toDouble())
      payload.put("screenX", e.rawX.toDouble())
      payload.put("screenY", e.rawY.toDouble())
      payload.put("timestamp", e.eventTime.toDouble())
      val toolType = if (e.pointerCount > 0) e.getToolType(0) else MotionEvent.TOOL_TYPE_FINGER
      payload.put("pointerType", when (toolType) {
        MotionEvent.TOOL_TYPE_FINGER -> "touch"
        MotionEvent.TOOL_TYPE_STYLUS -> "pen"
        else -> "mouse"
      })
      if (e.buttonState != 0) {
        payload.put("button", e.buttonState)
      }
      val modifiers = JSONObject()
      modifiers.put("altKey", e.metaState and KeyEvent.META_ALT_ON != 0)
      modifiers.put("ctrlKey", e.metaState and KeyEvent.META_CTRL_ON != 0)
      modifiers.put("metaKey", e.metaState and KeyEvent.META_META_ON != 0)
      modifiers.put("shiftKey", e.metaState and KeyEvent.META_SHIFT_ON != 0)
      payload.put("modifiers", modifiers)
    }
    return payload
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!shouldHandleInteraction() || nodeId < 0) {
      return super.onTouchEvent(event)
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        pressedDown = true
        longPressTriggered = false
        lastDownEvent?.recycle()
        lastDownEvent = MotionEvent.obtain(event)
        downX = event.x
        downY = event.y
        pressStartTimeMs = SystemClock.uptimeMillis()
        isPressed = true
        if (!preventFocusOnPress && focusableSurface) {
          requestFocus()
        }
        if (!allowTouchPropagation) {
          parent?.requestDisallowInterceptTouchEvent(true)
        }
        schedulePressIn(event)
        scheduleLongPress(event)
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (!pressedDown) return super.onTouchEvent(event)
        val dx = event.x - downX
        val dy = event.y - downY
        val distance = hypot(dx.toDouble(), dy.toDouble()).toFloat()
        if (cancelOnOutside && pressRetentionOffsetPx > 0 && distance > pressRetentionOffsetPx) {
          cancelCurrentPress(true, event)
          return true
        }
        return super.onTouchEvent(event)
      }
      MotionEvent.ACTION_UP -> {
        if (!pressedDown) return super.onTouchEvent(event)
        val payload = createPayload(event)
        pressedDown = false
        cancelPressIn()
        cancelLongPress()
        if (!longPressTriggered) {
          listener?.onPressablePress(nodeId, payload)
          if (enableDoublePress) {
            val now = SystemClock.uptimeMillis()
            if (lastPressUpTimeMs > 0 && now - lastPressUpTimeMs <= doublePressWindowMs) {
              listener?.onPressableDoublePress(nodeId, payload)
            }
            lastPressUpTimeMs = now
          }
        }
        pressVisible = false
        isPressed = false
        updatePressVisualState(animated = true)
        schedulePressOut(event, cancelled = false)
        longPressTriggered = false
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelCurrentPress(true, event)
        return true
      }
    }
    return super.onTouchEvent(event)
  }

  private fun cancelCurrentPress(cancelled: Boolean, event: MotionEvent?) {
    if (!pressedDown) return
    pressedDown = false
    cancelPressIn()
    cancelLongPress()
    pressVisible = false
    isPressed = false
    updatePressVisualState(animated = true)
    schedulePressOut(event, cancelled)
    listener?.onPressableCancel(nodeId, createPayload(event))
    longPressTriggered = false
  }

  override fun onHoverEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> {
        listener?.onPressableHover(nodeId, true)
      }
      MotionEvent.ACTION_HOVER_EXIT -> {
        listener?.onPressableHover(nodeId, false)
      }
    }
    return super.onHoverEvent(event)
  }

  override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent): Boolean {
    val keyName = android.view.KeyEvent.keyCodeToString(keyCode).removePrefix("KEYCODE_")
    val normalizedKey = keyName.uppercase()
    if (activateKeys.contains(normalizedKey)) {
      if (!pressedDown) {
        pressedDown = true
        pressVisible = true
        updatePressVisualState(animated = true)
        listener?.onPressablePressIn(
          nodeId,
          createPayload(null).apply { put("pointerType", "keyboard") },
        )
      }
      return true
    }
    val payload = JSONObject().put("key", keyName)
    listener?.onPressableKeyEvent(nodeId, "onKeyDown", payload)
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: android.view.KeyEvent): Boolean {
    val keyName = android.view.KeyEvent.keyCodeToString(keyCode).removePrefix("KEYCODE_")
    val normalizedKey = keyName.uppercase()
    if (activateKeys.contains(normalizedKey)) {
      if (pressedDown) {
        pressedDown = false
        listener?.onPressablePress(
          nodeId,
          createPayload(null).apply { put("pointerType", "keyboard") },
        )
        listener?.onPressablePressOut(
          nodeId,
          createPayload(null).apply { put("pointerType", "keyboard") },
          false,
        )
        pressVisible = false
        updatePressVisualState(animated = true)
      }
      return true
    }
    val payload = JSONObject().put("key", keyName)
    listener?.onPressableKeyEvent(nodeId, "onKeyUp", payload)
    return super.onKeyUp(keyCode, event)
  }

  fun setDisabled(value: Boolean) {
    disabled = value
    isEnabled = !value
    updatePressVisualState(animated = true)
  }

  fun setFocusableSurface(enabled: Boolean) {
    focusableSurface = enabled
    isFocusable = enabled
    isFocusableInTouchMode = enabled
  }

  fun setPreventFocusOnPress(value: Boolean) {
    preventFocusOnPress = value
  }

  fun setPressEffect(effect: String?) {
    val normalized = effect?.lowercase() ?: "none"
    if (pressEffect == normalized) return
    pressEffect = normalized
    when (normalized) {
      "none" -> {
        foreground = null
      }
      "ripple" -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          val rippleColor = ColorStateList.valueOf(0x33FFFFFF)
          foreground = RippleDrawable(rippleColor, null, null)
        } else {
          pressEffect = "highlight"
          foreground = null
        }
      }
      else -> {
        foreground = null
      }
    }
    updatePressVisualState(animated = false)
  }

  fun setPressRetentionOffset(value: Number?) {
    val raw = value?.toFloat() ?: DEFAULT_PRESS_RETENTION_DP
    pressRetentionOffsetPx = max(0f, raw * density)
  }

  fun setDelayPressIn(value: Number?) {
    delayPressInMs = max(0L, value?.toLong() ?: 0L)
  }

  fun setDelayPressOut(value: Number?) {
    delayPressOutMs = max(0L, value?.toLong() ?: 0L)
  }

  fun setDelayLongPress(value: Number?) {
    delayLongPressMs = max(0L, value?.toLong() ?: DEFAULT_LONG_PRESS_MS)
  }

  fun setHasLongPressHandler(value: Boolean) {
    hasLongPressHandler = value
  }

  fun setAllowTouchPropagation(value: Boolean) {
    allowTouchPropagation = value
  }

  fun setCancelOnOutside(value: Boolean) {
    cancelOnOutside = value
  }

  fun setEnableDoublePress(value: Boolean) {
    enableDoublePress = value
  }

  fun setDoublePressWindow(value: Number?) {
    doublePressWindowMs = max(0L, value?.toLong() ?: DEFAULT_DOUBLE_PRESS_WINDOW_MS)
  }

  fun setHitSlop(value: JSONObject?) {
    if (value == null || value == JSONObject.NULL) {
      hitSlop = null
      clearHitSlop()
      return
    }
    val top = value.optDouble("top", 0.0).toFloat()
    val left = value.optDouble("left", 0.0).toFloat()
    val bottom = value.optDouble("bottom", 0.0).toFloat()
    val right = value.optDouble("right", 0.0).toFloat()
    hitSlop = Rect(
      (left * density).roundToInt(),
      (top * density).roundToInt(),
      (right * density).roundToInt(),
      (bottom * density).roundToInt(),
    )
    if (isAttachedToWindow) {
      applyHitSlop()
    }
  }

  fun setActivateKeys(keys: Set<String>) {
    activateKeys = keys.map { it.uppercase() }.toSet()
  }

  fun setPointerEvents(value: String?) {
    pointerEvents = value ?: "auto"
    when (pointerEvents) {
      "none" -> {
        isClickable = false
        isEnabled = false
      }
      "box-none" -> {
        isClickable = false
        isEnabled = !disabled
      }
      else -> {
        isClickable = true
        isEnabled = !disabled
      }
    }
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

  fun handleCommand(command: JSONObject?) {
    if (command == null) return
    val seq = command.optLong("seq", -1L)
    if (seq >= 0 && seq <= lastCommandSeq) return
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
        val payload = createPayload(null)
        listener?.onPressablePressIn(nodeId, payload)
        listener?.onPressablePress(nodeId, payload)
        listener?.onPressablePressOut(nodeId, payload, false)
      }
      "cancel" -> {
        cancelCurrentPress(true, null)
      }
    }
  }
}
