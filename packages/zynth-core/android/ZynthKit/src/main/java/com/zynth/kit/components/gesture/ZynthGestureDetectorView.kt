package com.zynth.kit.components.gesture

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewConfiguration
import android.widget.FrameLayout
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot

class ZynthGestureDetectorView(context: Context) : FrameLayout(context) {
  private var manager: ZynthUIManager? = null
  private var nodeId: Int = -1

  private val density = context.resources.displayMetrics.density.coerceAtLeast(1f)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

  private var tapEnabled = false
  private var longPressEnabled = false
  private var rotationEnabled = false
  private var pinchEnabled = false
  private var flingEnabled = false
  private var panEnabled = false

  private var longPressMinDurationMs = 500.0
  private var flingMinVelocityDp = 800.0
  private var panSharedSignalX = 0
  private var panSharedSignalY = 0
  private var panSignalBaseX = 0.0
  private var panSignalBaseY = 0.0
  private var panSignalCurrentX = 0.0
  private var panSignalCurrentY = 0.0

  private var downX = 0f
  private var downY = 0f
  private var downRawX = 0f
  private var downRawY = 0f
  private var downTimestamp = 0L

  private var lastX = 0f
  private var lastY = 0f
  private var lastRawX = 0f
  private var lastRawY = 0f

  private var panActive = false
  private var rotationActive = false
  private var pinchActive = false
  private var longPressActive = false

  private var rotationStartAngle = 0f
  private var rotationValue = 0f
  private var lastRotationTimeMs = 0L

  private var scaleValue = 1f

  private var velocityTracker: VelocityTracker? = null
  private var disallowInterceptRequested = false

  private val longPressRunnable = Runnable {
    if (!longPressEnabled) return@Runnable
    if (longPressActive) return@Runnable
    longPressActive = true
    emitLongPress("start", durationMs = longPressMinDurationMs)
  }

  private val gestureDetector: GestureDetector = GestureDetector(
    context,
    object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(e: MotionEvent): Boolean {
        return true
      }

      override fun onSingleTapUp(e: MotionEvent): Boolean {
        if (!tapEnabled) return false
        emitTap(e)
        return true
      }

      override fun onFling(
        e1: MotionEvent?,
        e2: MotionEvent,
        velocityX: Float,
        velocityY: Float,
      ): Boolean {
        if (!flingEnabled) return false
        val velocityXDp = toDp(velocityX)
        val velocityYDp = toDp(velocityY)
        val speed = hypot(velocityXDp, velocityYDp)
        if (speed < flingMinVelocityDp) {
          return false
        }

        val direction = when {
          abs(velocityX) >= abs(velocityY) && velocityX > 0f -> "right"
          abs(velocityX) >= abs(velocityY) && velocityX < 0f -> "left"
          velocityY > 0f -> "down"
          velocityY < 0f -> "up"
          else -> "unknown"
        }

        val payload = basePayload(
          phase = "end",
          x = e2.x,
          y = e2.y,
          rawX = e2.rawX,
          rawY = e2.rawY,
          timestamp = e2.eventTime,
        )
        payload.put("velocityX", velocityXDp)
        payload.put("velocityY", velocityYDp)
        payload.put("direction", direction)
        emit("onFlingGesture", payload)
        return true
      }
    }
  )

  private val scaleGestureDetector =
    android.view.ScaleGestureDetector(
      context,
      object : android.view.ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScaleBegin(detector: android.view.ScaleGestureDetector): Boolean {
          if (!pinchEnabled) return false
          pinchActive = true
          scaleValue = 1f
          val payload = basePayload(
            phase = "start",
            x = detector.focusX,
            y = detector.focusY,
            rawX = detector.focusX,
            rawY = detector.focusY,
            timestamp = System.currentTimeMillis(),
          )
          payload.put("scale", 1.0)
          payload.put("velocity", 0.0)
          payload.put("focalX", toDp(detector.focusX))
          payload.put("focalY", toDp(detector.focusY))
          emit("onPinchGesture", payload)
          return true
        }

        override fun onScale(detector: android.view.ScaleGestureDetector): Boolean {
          if (!pinchEnabled || !pinchActive) return false
          scaleValue *= detector.scaleFactor
          val payload = basePayload(
            phase = "update",
            x = detector.focusX,
            y = detector.focusY,
            rawX = detector.focusX,
            rawY = detector.focusY,
            timestamp = System.currentTimeMillis(),
          )
          payload.put("scale", scaleValue.toDouble())
          payload.put("velocity", ((detector.scaleFactor - 1f) * 60f).toDouble())
          payload.put("focalX", toDp(detector.focusX))
          payload.put("focalY", toDp(detector.focusY))
          emit("onPinchGesture", payload)
          return true
        }

        override fun onScaleEnd(detector: android.view.ScaleGestureDetector) {
          if (!pinchEnabled || !pinchActive) return
          val endPayload = basePayload(
            phase = "end",
            x = detector.focusX,
            y = detector.focusY,
            rawX = detector.focusX,
            rawY = detector.focusY,
            timestamp = System.currentTimeMillis(),
          )
          endPayload.put("scale", scaleValue.toDouble())
          endPayload.put("velocity", 0.0)
          endPayload.put("focalX", toDp(detector.focusX))
          endPayload.put("focalY", toDp(detector.focusY))
          emit("onPinchGesture", endPayload)

          val deactivatePayload = JSONObject(endPayload.toString())
          deactivatePayload.put("phase", "deactivate")
          emit("onPinchGesture", deactivatePayload)

          pinchActive = false
          scaleValue = 1f
        }
      }
    )

  init {
    isClickable = true
    isFocusable = true
  }

  fun bind(manager: ZynthUIManager, nodeId: Int) {
    this.manager = manager
    this.nodeId = nodeId
  }

  fun setLongPressMinDurationMs(value: Double) {
    longPressMinDurationMs = value.coerceAtLeast(0.0)
  }

  fun setFlingMinVelocity(value: Double) {
    flingMinVelocityDp = value.coerceAtLeast(0.0)
  }

  fun setPanSharedSignalX(value: Int) {
    panSharedSignalX = if (value > 0) value else 0
  }

  fun setPanSharedSignalY(value: Int) {
    panSharedSignalY = if (value > 0) value else 0
  }

  fun enableEvent(name: String) {
    when (name) {
      "onTapGesture" -> tapEnabled = true
      "onLongPressGesture" -> longPressEnabled = true
      "onRotationGesture" -> rotationEnabled = true
      "onPinchGesture" -> pinchEnabled = true
      "onFlingGesture" -> flingEnabled = true
      "onPanGesture" -> panEnabled = true
    }
  }

  fun reset() {
    manager = null
    nodeId = -1
    tapEnabled = false
    longPressEnabled = false
    rotationEnabled = false
    pinchEnabled = false
    flingEnabled = false
    panEnabled = false
    longPressMinDurationMs = 500.0
    flingMinVelocityDp = 800.0
    panSharedSignalX = 0
    panSharedSignalY = 0
    panSignalBaseX = 0.0
    panSignalBaseY = 0.0
    panSignalCurrentX = 0.0
    panSignalCurrentY = 0.0
    panActive = false
    rotationActive = false
    pinchActive = false
    longPressActive = false
    rotationStartAngle = 0f
    rotationValue = 0f
    lastRotationTimeMs = 0L
    scaleValue = 1f
    mainHandler.removeCallbacks(longPressRunnable)
    velocityTracker?.recycle()
    velocityTracker = null
    releaseTouchCapture()
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (!hasEnabledGestures()) return super.dispatchTouchEvent(event)

    // Let children have a chance to handle the touch first.
    // We still process the gesture regardless of whether a child consumed it.
    val handledByChild = super.dispatchTouchEvent(event)

    lastX = event.x
    lastY = event.y
    lastRawX = event.rawX
    lastRawY = event.rawY

    velocityTracker = (velocityTracker ?: VelocityTracker.obtain()).also {
      it.addMovement(event)
    }

    gestureDetector.onTouchEvent(event)
    scaleGestureDetector.onTouchEvent(event)

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        requestTouchCapture()
        downX = event.x
        downY = event.y
        downRawX = event.rawX
        downRawY = event.rawY
        downTimestamp = event.eventTime
        syncPanSignalBaseFromNative()
        cancelNativePanSignalAnimations()
        panSignalBaseX = panSignalCurrentX
        panSignalBaseY = panSignalCurrentY
        panActive = false
        rotationActive = false
        pinchActive = false
        rotationStartAngle = 0f
        rotationValue = 0f
        lastRotationTimeMs = 0L
        longPressActive = false
        mainHandler.removeCallbacks(longPressRunnable)
        if (longPressEnabled) {
          mainHandler.postDelayed(longPressRunnable, longPressMinDurationMs.toLong())
        }
      }

      MotionEvent.ACTION_POINTER_DOWN -> {
        if (rotationEnabled && event.pointerCount >= 2 && !rotationActive) {
          rotationStartAngle = calculateAngle(event)
          rotationValue = 0f
          lastRotationTimeMs = event.eventTime
          rotationActive = true
          emitRotation(
            phase = "start",
            rotation = 0f,
            velocity = 0f,
            event = event,
          )
        }
      }

      MotionEvent.ACTION_MOVE -> {
        if (longPressEnabled && !longPressActive) {
          val moved = hypot(event.x - downX, event.y - downY)
          if (moved > touchSlop) {
            mainHandler.removeCallbacks(longPressRunnable)
          }
        }

        if (panEnabled) {
          val translationX = event.x - downX
          val translationY = event.y - downY
          val distance = hypot(translationX, translationY)
          if (!panActive && distance >= 2f) {
            panActive = true
            emitPan(
              phase = "start",
              translationX = translationX,
              translationY = translationY,
              event = event,
            )
          }
          if (panActive) {
            updateNativePanSignals(translationX, translationY)
            emitPan(
              phase = "update",
              translationX = translationX,
              translationY = translationY,
              event = event,
            )
          }
        }

        if (rotationEnabled && rotationActive && event.pointerCount >= 2) {
          val angle = calculateAngle(event)
          val rotation = normalizeAngle(angle - rotationStartAngle)
          val dt = (event.eventTime - lastRotationTimeMs).coerceAtLeast(1L)
          val velocity = (rotation - rotationValue) / (dt / 1000f)
          rotationValue = rotation
          lastRotationTimeMs = event.eventTime
          emitRotation(
            phase = "update",
            rotation = rotation,
            velocity = velocity,
            event = event,
          )
        }
      }

      MotionEvent.ACTION_POINTER_UP -> {
        if (rotationEnabled && rotationActive && event.pointerCount <= 2) {
          emitRotation(
            phase = "end",
            rotation = rotationValue,
            velocity = 0f,
            event = event,
          )
          emitRotation(
            phase = "deactivate",
            rotation = rotationValue,
            velocity = 0f,
            event = event,
          )
          rotationActive = false
          rotationValue = 0f
        }
      }

      MotionEvent.ACTION_UP -> {
        mainHandler.removeCallbacks(longPressRunnable)
        if (longPressEnabled && longPressActive) {
          emitLongPress("end", durationMs = (event.eventTime - downTimestamp).toDouble())
          emitLongPress("deactivate", durationMs = (event.eventTime - downTimestamp).toDouble())
          longPressActive = false
        }

        if (panEnabled && panActive) {
          updateNativePanSignals(event.x - downX, event.y - downY)
          emitPan(
            phase = "end",
            translationX = event.x - downX,
            translationY = event.y - downY,
            event = event,
          )
          emitPan(
            phase = "deactivate",
            translationX = event.x - downX,
            translationY = event.y - downY,
            event = event,
          )
          panSignalBaseX = panSignalCurrentX
          panSignalBaseY = panSignalCurrentY
          panActive = false
        }

        if (rotationEnabled && rotationActive) {
          emitRotation(
            phase = "end",
            rotation = rotationValue,
            velocity = 0f,
            event = event,
          )
          emitRotation(
            phase = "deactivate",
            rotation = rotationValue,
            velocity = 0f,
            event = event,
          )
          rotationActive = false
          rotationValue = 0f
        }

        velocityTracker?.recycle()
        velocityTracker = null
        releaseTouchCapture()
      }

      MotionEvent.ACTION_CANCEL -> {
        mainHandler.removeCallbacks(longPressRunnable)

        if (longPressEnabled && longPressActive) {
          emitLongPress("deactivate", durationMs = (event.eventTime - downTimestamp).toDouble())
          longPressActive = false
        }

        if (panEnabled && panActive) {
          updateNativePanSignals(event.x - downX, event.y - downY)
          emitPan(
            phase = "deactivate",
            translationX = event.x - downX,
            translationY = event.y - downY,
            event = event,
          )
          panSignalBaseX = panSignalCurrentX
          panSignalBaseY = panSignalCurrentY
          panActive = false
        }

        if (rotationEnabled && rotationActive) {
          emitRotation(
            phase = "deactivate",
            rotation = rotationValue,
            velocity = 0f,
            event = event,
          )
          rotationActive = false
          rotationValue = 0f
        }

        if (pinchEnabled && pinchActive) {
          val payload = basePayload(
            phase = "deactivate",
            x = event.x,
            y = event.y,
            rawX = event.rawX,
            rawY = event.rawY,
            timestamp = event.eventTime,
          )
          payload.put("scale", scaleValue.toDouble())
          payload.put("velocity", 0.0)
          payload.put("focalX", toDp(event.x))
          payload.put("focalY", toDp(event.y))
          emit("onPinchGesture", payload)
          pinchActive = false
          scaleValue = 1f
        }

        velocityTracker?.recycle()
        velocityTracker = null
        releaseTouchCapture()
      }

      MotionEvent.ACTION_OUTSIDE -> {
        mainHandler.removeCallbacks(longPressRunnable)

        if (longPressEnabled && longPressActive) {
          emitLongPress("deactivate", durationMs = (event.eventTime - downTimestamp).toDouble())
          longPressActive = false
        }

        if (panEnabled && panActive) {
          updateNativePanSignals(event.x - downX, event.y - downY)
          emitPan(
            phase = "deactivate",
            translationX = event.x - downX,
            translationY = event.y - downY,
            event = event,
          )
          panSignalBaseX = panSignalCurrentX
          panSignalBaseY = panSignalCurrentY
          panActive = false
        }

        if (rotationEnabled && rotationActive) {
          emitRotation(
            phase = "deactivate",
            rotation = rotationValue,
            velocity = 0f,
            event = event,
          )
          rotationActive = false
          rotationValue = 0f
        }

        velocityTracker?.recycle()
        velocityTracker = null
        releaseTouchCapture()
      }
    }

    // Keep this detector as the active touch owner while gestures are enabled.
    return true
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (hasEnabledGestures()) return true
    return super.onInterceptTouchEvent(ev)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (hasEnabledGestures()) return true
    return super.onTouchEvent(event)
  }

  private fun hasEnabledGestures(): Boolean {
    return tapEnabled ||
      longPressEnabled ||
      rotationEnabled ||
      pinchEnabled ||
      flingEnabled ||
      panEnabled
  }

  private fun emitTap(event: MotionEvent) {
    val payload = basePayload(
      phase = "end",
      x = event.x,
      y = event.y,
      rawX = event.rawX,
      rawY = event.rawY,
      timestamp = event.eventTime,
    )
    payload.put("numberOfTaps", 1)
    emit("onTapGesture", payload)
  }

  private fun emitLongPress(phase: String, durationMs: Double) {
    val payload = basePayload(
      phase = phase,
      x = lastX,
      y = lastY,
      rawX = lastRawX,
      rawY = lastRawY,
      timestamp = System.currentTimeMillis(),
    )
    payload.put("durationMs", durationMs)
    emit("onLongPressGesture", payload)
  }

  private fun emitPan(
    phase: String,
    translationX: Float,
    translationY: Float,
    event: MotionEvent,
  ) {
    velocityTracker?.computeCurrentVelocity(1000)
    val velocityX = velocityTracker?.xVelocity ?: 0f
    val velocityY = velocityTracker?.yVelocity ?: 0f

    val payload = basePayload(
      phase = phase,
      x = event.x,
      y = event.y,
      rawX = event.rawX,
      rawY = event.rawY,
      timestamp = event.eventTime,
    )
    payload.put("translationX", toDp(translationX))
    payload.put("translationY", toDp(translationY))
    payload.put("velocityX", toDp(velocityX))
    payload.put("velocityY", toDp(velocityY))
    emit("onPanGesture", payload)
  }

  private fun updateNativePanSignals(translationX: Float, translationY: Float) {
    val currentManager = manager ?: return
    val hasX = panSharedSignalX > 0
    val hasY = panSharedSignalY > 0
    if (!hasX && !hasY) return

    if (hasX) {
      val nextX = panSignalBaseX + toDp(translationX)
      currentManager.setSharedSignal(panSharedSignalX, nextX)
      panSignalCurrentX = nextX
    }

    if (hasY) {
      val nextY = panSignalBaseY + toDp(translationY)
      currentManager.setSharedSignal(panSharedSignalY, nextY)
      panSignalCurrentY = nextY
    }
  }

  private fun syncPanSignalBaseFromNative() {
    val currentManager = manager ?: return
    if (panSharedSignalX > 0) {
      val value = currentManager.getSharedSignal(panSharedSignalX)
      if (value != null) {
        panSignalCurrentX = value
      }
    }
    if (panSharedSignalY > 0) {
      val value = currentManager.getSharedSignal(panSharedSignalY)
      if (value != null) {
        panSignalCurrentY = value
      }
    }
  }

  private fun cancelNativePanSignalAnimations() {
    val currentManager = manager ?: return
    if (panSharedSignalX > 0) {
      currentManager.cancelSharedSignalAnimation(panSharedSignalX)
    }
    if (panSharedSignalY > 0) {
      currentManager.cancelSharedSignalAnimation(panSharedSignalY)
    }
  }

  private fun emitRotation(
    phase: String,
    rotation: Float,
    velocity: Float,
    event: MotionEvent,
  ) {
    val payload = basePayload(
      phase = phase,
      x = event.x,
      y = event.y,
      rawX = event.rawX,
      rawY = event.rawY,
      timestamp = event.eventTime,
    )
    payload.put("rotation", rotation.toDouble())
    payload.put("velocity", velocity.toDouble())
    payload.put("anchorX", toDp(event.x))
    payload.put("anchorY", toDp(event.y))
    emit("onRotationGesture", payload)
  }

  private fun calculateAngle(event: MotionEvent): Float {
    if (event.pointerCount < 2) return 0f
    val x0 = event.getX(0)
    val y0 = event.getY(0)
    val x1 = event.getX(1)
    val y1 = event.getY(1)
    return Math.toDegrees(atan2((y1 - y0), (x1 - x0)).toDouble()).toFloat()
  }

  private fun normalizeAngle(angle: Float): Float {
    var value = angle
    while (value > 180f) value -= 360f
    while (value < -180f) value += 360f
    return value
  }

  private fun basePayload(
    phase: String,
    x: Float,
    y: Float,
    rawX: Float,
    rawY: Float,
    timestamp: Long,
  ): JSONObject {
    return JSONObject()
      .put("phase", phase)
      .put("timestamp", timestamp.toDouble())
      .put("x", toDp(x))
      .put("y", toDp(y))
      .put("absoluteX", toDp(rawX))
      .put("absoluteY", toDp(rawY))
  }

  private fun emit(name: String, payload: JSONObject) {
    val currentManager = manager ?: return
    if (nodeId < 0) return
    currentManager.dispatchEvent(nodeId, name, payload)
  }

  private fun toDp(px: Float): Double {
    return (px / density).toDouble()
  }

  private fun requestTouchCapture() {
    if (disallowInterceptRequested) return
    parent?.requestDisallowInterceptTouchEvent(true)
    disallowInterceptRequested = true
  }

  private fun releaseTouchCapture() {
    if (!disallowInterceptRequested) return
    parent?.requestDisallowInterceptTouchEvent(false)
    disallowInterceptRequested = false
  }
}
