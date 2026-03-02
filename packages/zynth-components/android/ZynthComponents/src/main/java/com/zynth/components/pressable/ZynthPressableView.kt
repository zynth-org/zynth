package com.zynth.components.pressable

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Path
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.TouchDelegate
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import com.zynth.kit.core.ZynthBorderDrawable
import com.zynth.kit.core.ZynthEventSink
import com.zynth.kit.core.ZynthLayoutView
import java.util.Arrays
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import org.json.JSONObject

private const val DEFAULT_PRESS_RETENTION_DP = 20f
private const val DEFAULT_LONG_PRESS_MS = 500L
private const val DEFAULT_DOUBLE_PRESS_WINDOW_MS = 250L
private const val PRESS_FADE_ANIMATION_MS = 120L

class ZynthPressableView(context: Context) : ZynthLayoutView(context) {

  var nodeId: Int = -1
  var listener: ZynthEventSink? = null

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
  private var lastRadii: FloatArray? = null

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
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES

    setOnFocusChangeListener { _, hasFocus ->
      if (nodeId < 0) return@setOnFocusChangeListener
      if (hasFocus) {
        listener?.dispatchEvent(nodeId, "onFocus", null)
      } else {
        listener?.dispatchEvent(nodeId, "onBlur", null)
      }
    }
    updatePressVisualState(animated = false)
  }

  fun resetState() {
    cancelPressIn()
    cancelPressOut()
    cancelLongPress()
    pressedDown = false
    pressVisible = false
    longPressTriggered = false
    hasLongPressHandler = false
    pressStartTimeMs = 0L
    lastPressUpTimeMs = -1L
    downX = 0f
    downY = 0f
    lastDownEvent = null

    setDisabled(false)
    setFocusableSurface(true)
    setPreventFocusOnPress(false)
    setPressEffect("none")
    setPressRetentionOffset(null)
    setDelayPressIn(null)
    setDelayPressOut(null)
    setDelayLongPress(null)
    setAllowTouchPropagation(false)
    setCancelOnOutside(true)
    setEnableDoublePress(false)
    setDoublePressWindow(null)
    setActivateKeys(emptySet())
    setPointerEvents("auto")

    hitSlop = null
    clearHitSlop()

    nodeId = -1
    listener = null
    lastCommandSeq = -1L
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // Yoga drives layout via explicit view.layout calls.
    // However, during Android layout passes, we must confirm children positions
    // to prevent FrameLayout from overwriting them with 0x0 (since onMeasure might be skipped).
    for (i in 0 until childCount) {
      val child = getChildAt(i)
      child.layout(child.left, child.top, child.right, child.bottom)
    }
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
      listener?.dispatchEvent(nodeId, "onPressIn", payload)
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
      pressVisible = false
      payload.put("cancelled", cancelled)
      listener?.dispatchEvent(nodeId, "onPressOut", payload)
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
      payload.put("durationMs", duration)
      listener?.dispatchEvent(nodeId, "onLongPress", payload)
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
    val source = event ?: lastDownEvent
    if (source != null) {
      payload.put("x", source.x)
      payload.put("y", source.y)
      payload.put("timestamp", source.eventTime.toDouble())
      payload.put(
        "pointerType",
        when (source.getToolType(0)) {
          MotionEvent.TOOL_TYPE_MOUSE -> "mouse"
          MotionEvent.TOOL_TYPE_STYLUS -> "pen"
          else -> "touch"
        },
      )
    } else {
      payload.put("x", 0)
      payload.put("y", 0)
      payload.put("timestamp", SystemClock.uptimeMillis().toDouble())
      payload.put("pointerType", "touch")
    }
    return payload
  }

  private fun beginPress(event: MotionEvent) {
    if (!shouldHandleInteraction()) return
    pressedDown = true
    isPressed = true
    longPressTriggered = false
    lastDownEvent = MotionEvent.obtain(event)
    schedulePressIn(event)
    scheduleLongPress(event)
    pressStartTimeMs = SystemClock.uptimeMillis()
    if (!preventFocusOnPress && focusableSurface) {
      requestFocus()
    }
  }

  private fun endPress(event: MotionEvent?, cancelled: Boolean) {
    if (!pressedDown) return
    pressedDown = false
    
    val minDuration = 150L
    val elapsed = SystemClock.uptimeMillis() - pressStartTimeMs
    if (!cancelled && elapsed < minDuration) {
      mainHandler.postDelayed({
        // Only unset if we haven't started a new press
        if (!pressedDown) {
          isPressed = false
        }
      }, minDuration - elapsed)
    } else {
      isPressed = false
    }

    cancelPressIn()
    cancelLongPress()
    val payload = createPayload(event)
    if (!longPressTriggered && !cancelled) {
      listener?.dispatchEvent(nodeId, "onPress", payload)
      if (enableDoublePress) {
        val now = SystemClock.uptimeMillis()
        if (lastPressUpTimeMs > 0 && now - lastPressUpTimeMs <= doublePressWindowMs) {
          listener?.dispatchEvent(nodeId, "onDoublePress", payload)
        }
        lastPressUpTimeMs = now
      }
    }
    schedulePressOut(event, cancelled)
  }

  private fun cancelCurrentPress(cancelled: Boolean, event: MotionEvent?) {
    if (!pressedDown) return
    endPress(event, cancelled)
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (!shouldHandleInteraction()) return super.onInterceptTouchEvent(ev)
    if (allowTouchPropagation) return super.onInterceptTouchEvent(ev)
    return true
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!shouldHandleInteraction()) return false
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          drawableHotspotChanged(event.x, event.y)
          foreground?.setHotspot(event.x, event.y)
        }
        beginPress(event)
      }
      MotionEvent.ACTION_MOVE -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          drawableHotspotChanged(event.x, event.y)
          foreground?.setHotspot(event.x, event.y)
        }
        val dx = event.x - downX
        val dy = event.y - downY
        val distance = hypot(dx, dy)
        if (cancelOnOutside && distance > pressRetentionOffsetPx) {
          cancelCurrentPress(true, event)
        }
      }
      MotionEvent.ACTION_UP -> {
        endPress(event, cancelled = false)
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelCurrentPress(true, event)
      }
    }
    return true
  }

  override fun onHoverEvent(event: MotionEvent): Boolean {
    if (!shouldHandleInteraction()) return super.onHoverEvent(event)
    when (event.actionMasked) {
      MotionEvent.ACTION_HOVER_ENTER -> listener?.dispatchEvent(nodeId, "onHoverIn", null)
      MotionEvent.ACTION_HOVER_EXIT -> listener?.dispatchEvent(nodeId, "onHoverOut", null)
    }
    return super.onHoverEvent(event)
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (!focusableSurface) return super.dispatchKeyEvent(event)
    val keyName = KeyEvent.keyCodeToString(event.keyCode).removePrefix("KEYCODE_")
    val identifier = keyName.uppercase()
    if (!activateKeys.contains(identifier)) {
      return super.dispatchKeyEvent(event)
    }
    val payload = JSONObject().apply {
      put("key", keyName.uppercase())
      put("code", event.keyCode)
      put("repeat", event.repeatCount > 0)
    }
    val phase = if (event.action == KeyEvent.ACTION_DOWN) "onKeyDown" else "onKeyUp"
    listener?.dispatchEvent(nodeId, phase, payload)
    if (event.action == KeyEvent.ACTION_DOWN && !pressedDown) {
      pressedDown = true
      isPressed = true
      pressVisible = true
      updatePressVisualState(animated = true)
      listener?.dispatchEvent(nodeId, "onPressIn", payload)
    } else if (event.action == KeyEvent.ACTION_UP && pressedDown) {
      pressedDown = false
      isPressed = false
      pressVisible = false
      updatePressVisualState(animated = true)
      payload.put("cancelled", false)
      listener?.dispatchEvent(nodeId, "onPressOut", payload)
      listener?.dispatchEvent(nodeId, "onPress", payload)
    }
    return true
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    return if (focusableSurface && keyCode == KeyEvent.KEYCODE_ENTER) {
      listener?.dispatchEvent(nodeId, "onPress", createPayload(null))
      true
    } else {
      super.onKeyDown(keyCode, event)
    }
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
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
          updateRippleMask()
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

  override fun setBorderRadii(tl: Float, tr: Float, br: Float, bl: Float) {
    super.setBorderRadii(tl, tr, br, bl)
    updateRippleMask()
    updateOutline()
  }

  override fun setBackground(background: Drawable?) {
    super.setBackground(background)
    updateRippleMask()
    updateOutline()
  }

  private fun updateOutline() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      val tl = borderTopLeftRadius
      val tr = borderTopRightRadius
      val br = borderBottomRightRadius
      val bl = borderBottomLeftRadius

      val hasRadius = tl > 0f || tr > 0f || br > 0f || bl > 0f
      if (hasRadius) {
        outlineProvider = object : ViewOutlineProvider() {
          override fun getOutline(view: View, outline: Outline) {
            val width = view.width
            val height = view.height
            if (tl == tr && tr == br && br == bl) {
              outline.setRoundRect(0, 0, width, height, tl)
            } else {
              val path = Path()
              path.addRoundRect(
                0f, 0f, width.toFloat(), height.toFloat(),
                floatArrayOf(tl, tl, tr, tr, br, br, bl, bl),
                Path.Direction.CW
              )
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                outline.setPath(path)
              } else {
                @Suppress("DEPRECATION")
                if (path.isConvex) {
                  @Suppress("DEPRECATION")
                  outline.setConvexPath(path)
                } else {
                  outline.setRoundRect(0, 0, width, height, max(max(tl, tr), max(br, bl)))
                }
              }
            }
          }
        }
        clipToOutline = true
      } else {
        outlineProvider = ViewOutlineProvider.BACKGROUND
        clipToOutline = false
      }
      invalidateOutline()
    }
  }

  private fun updateRippleMask() {
    if (pressEffect != "ripple" || Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return

    var currentRadii: FloatArray? = null
    val mask: Drawable = if (background is ZynthBorderDrawable) {
      val borderDrawable = background as ZynthBorderDrawable
      val radii = floatArrayOf(
        borderDrawable.borderTopLeftRadius, borderDrawable.borderTopLeftRadius,
        borderDrawable.borderTopRightRadius, borderDrawable.borderTopRightRadius,
        borderDrawable.borderBottomRightRadius, borderDrawable.borderBottomRightRadius,
        borderDrawable.borderBottomLeftRadius, borderDrawable.borderBottomLeftRadius
      )
      currentRadii = radii
      GradientDrawable().apply {
        setColor(Color.WHITE)
        cornerRadii = radii
      }
    } else {
      val hasRadius = borderTopLeftRadius > 0f || borderTopRightRadius > 0f ||
              borderBottomRightRadius > 0f || borderBottomLeftRadius > 0f
      if (hasRadius) {
        val radii = floatArrayOf(
          borderTopLeftRadius, borderTopLeftRadius,
          borderTopRightRadius, borderTopRightRadius,
          borderBottomRightRadius, borderBottomRightRadius,
          borderBottomLeftRadius, borderBottomLeftRadius
        )
        currentRadii = radii
        GradientDrawable().apply {
          setColor(Color.WHITE)
          cornerRadii = radii
        }
      } else {
        currentRadii = floatArrayOf(0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f)
        ColorDrawable(Color.WHITE)
      }
    }

    if (lastRadii != null && Arrays.equals(lastRadii, currentRadii)) {
      return
    }
    lastRadii = currentRadii

    val states = arrayOf(
      intArrayOf(android.R.attr.state_pressed),
      intArrayOf()
    )
    val colors = intArrayOf(
      0x33FFFFFF,
      0x00FFFFFF
    )
    val rippleColor = ColorStateList(states, colors)
    foreground = RippleDrawable(rippleColor, null, mask)
    
    // If we are currently pressed, we must restore the hotspot on the new drawable
    // otherwise the ripple will restart from center.
    if (pressedDown && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      foreground?.setHotspot(downX, downY)
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
        val payload = createPayload(null)
        listener?.dispatchEvent(nodeId, "onPressIn", payload)
        listener?.dispatchEvent(nodeId, "onPress", payload)
        payload.put("cancelled", false)
        listener?.dispatchEvent(nodeId, "onPressOut", payload)
      }
      "cancel" -> {
        cancelCurrentPress(true, null)
        if (hasFocus()) {
          clearFocus()
        }
      }
    }
  }
}
