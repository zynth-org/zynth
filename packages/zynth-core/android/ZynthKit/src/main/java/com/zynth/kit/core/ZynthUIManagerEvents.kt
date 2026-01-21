package com.zynth.kit.core

import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.zynth.kit.runtime.JSBridge
import kotlin.math.max

internal fun ZynthUIManager.pointerModeFor(id: Int): String {
  return pointerEvents[id] ?: "auto"
}

internal fun ZynthUIManager.updateInteractionState(id: Int) {
  val view = nodes[id] ?: return
  val mode = pointerModeFor(id)
  val hasPress = pressNodes.contains(id)
  val enableInteraction = mode != "none"
  val enablePress = hasPress && mode != "none" && mode != "box-none"
  runOnMain {
    view.isEnabled = enableInteraction
    view.isClickable = enablePress
    view.isLongClickable = enablePress
  }
}

internal fun ZynthUIManager.attachTouchListener(id: Int) {
  val view = nodes[id] ?: return
  if (touchListeners.containsKey(id)) return
  val listener = View.OnTouchListener { v, event ->
    handleTouchEvent(id, v, event)
  }
  touchListeners[id] = listener
  runOnMain { view.setOnTouchListener(listener) }
}

internal fun ZynthUIManager.handleTouchEvent(id: Int, view: View, event: MotionEvent): Boolean {
  val mode = pointerModeFor(id)
  if (mode == "none" || mode == "box-none") {
    return false
  }
  when (event.actionMasked) {
    MotionEvent.ACTION_DOWN -> {
      activePressNodes.add(id)
      longPressFired.remove(id)
      pressLocalPoints[id] = event.x to event.y
      pressScreenPoints[id] = event.rawX to event.rawY
      scheduleLongPress(id)
      JSBridge.invokePressEvent(
        id,
        "onPressIn",
        event.x.toDouble(),
        event.y.toDouble(),
        event.rawX.toDouble(),
        event.rawY.toDouble(),
        -1.0,
        System.currentTimeMillis().toDouble(),
        false
      )
      return true
    }
    MotionEvent.ACTION_MOVE -> {
      pressLocalPoints[id] = event.x to event.y
      pressScreenPoints[id] = event.rawX to event.rawY
      return true
    }
    MotionEvent.ACTION_UP -> {
      cancelLongPress(id)
      activePressNodes.remove(id)
      val inside = event.x >= 0 && event.y >= 0 &&
        event.x <= view.width && event.y <= view.height
      val longPressed = longPressFired.contains(id)
      if (inside && !longPressed) {
        JSBridge.invokePressEvent(
          id,
          "onPress",
          event.x.toDouble(),
          event.y.toDouble(),
          event.rawX.toDouble(),
          event.rawY.toDouble(),
          -1.0,
          System.currentTimeMillis().toDouble(),
          false
        )
        maybeDispatchDoublePress(id, event)
      }
      JSBridge.invokePressEvent(
        id,
        "onPressOut",
        event.x.toDouble(),
        event.y.toDouble(),
        event.rawX.toDouble(),
        event.rawY.toDouble(),
        -1.0,
        System.currentTimeMillis().toDouble(),
        !inside
      )
      return true
    }
    MotionEvent.ACTION_CANCEL -> {
      cancelLongPress(id)
      activePressNodes.remove(id)
      JSBridge.invokePressEvent(
        id,
        "onPressOut",
        event.x.toDouble(),
        event.y.toDouble(),
        event.rawX.toDouble(),
        event.rawY.toDouble(),
        -1.0,
        System.currentTimeMillis().toDouble(),
        true
      )
      return true
    }
  }
  return false
}

internal fun ZynthUIManager.longPressDurationFor(id: Int): Double {
  val duration = longPressDurations[id] ?: 500.0
  return max(0.0, duration)
}

internal fun ZynthUIManager.doublePressWindowFor(id: Int): Double {
  val window = doublePressWindows[id] ?: 250.0
  return max(0.0, window)
}

internal fun ZynthUIManager.scheduleLongPress(id: Int) {
  if (!longPressNodes.contains(id)) return
  cancelLongPress(id)
  val delayMs = longPressDurationFor(id)
  val runnable = Runnable {
    if (!activePressNodes.contains(id)) {
      cancelLongPress(id)
      return@Runnable
    }
    if (longPressFired.contains(id)) {
      cancelLongPress(id)
      return@Runnable
    }
    longPressFired.add(id)
    val local = pressLocalPoints[id] ?: (0f to 0f)
    val screen = pressScreenPoints[id] ?: (0f to 0f)
    JSBridge.invokePressEvent(
      id,
      "onLongPress",
      local.first.toDouble(),
      local.second.toDouble(),
      screen.first.toDouble(),
      screen.second.toDouble(),
      delayMs,
      System.currentTimeMillis().toDouble(),
      false
    )
    cancelLongPress(id)
  }
  longPressRunnables[id] = runnable
  mainHandler.postDelayed(runnable, delayMs.toLong())
}

internal fun ZynthUIManager.cancelLongPress(id: Int) {
  val runnable = longPressRunnables.remove(id)
  if (runnable != null) {
    mainHandler.removeCallbacks(runnable)
  }
}

internal fun ZynthUIManager.maybeDispatchDoublePress(id: Int, event: MotionEvent) {
  val timestamp = System.currentTimeMillis().toDouble()
  if (!doublePressNodes.contains(id)) {
    lastPressTimestamps[id] = timestamp
    return
  }
  val last = lastPressTimestamps[id]
  lastPressTimestamps[id] = timestamp
  if (last == null) return
  val delta = timestamp - last
  if (delta < 0 || delta > doublePressWindowFor(id)) return
  JSBridge.invokePressEvent(
    id,
    "onDoublePress",
    event.x.toDouble(),
    event.y.toDouble(),
    event.rawX.toDouble(),
    event.rawY.toDouble(),
    -1.0,
    timestamp,
    false
  )
}

internal fun ZynthUIManager.dispatchLayoutEvents() {
  if (layoutNodes.isEmpty()) return
  for (id in layoutNodes) {
    val view = nodes[id] ?: continue
    val frame = android.graphics.Rect(view.left, view.top, view.right, view.bottom)
    val previous = layoutFrames[id]
    val changed = previous == null || !previous.equals(frame)
    val force = layoutPending.contains(id)
    if (!force && !changed) continue
    layoutFrames[id] = frame
    layoutPending.remove(id)
    JSBridge.invokeLayoutEvent(
      id,
      frame.left.toDouble(),
      frame.top.toDouble(),
      frame.width().toDouble(),
      frame.height().toDouble()
    )
  }
}

internal fun ZynthUIManager.cleanupNode(id: Int) {
  pointerEvents.remove(id)
  pressNodes.remove(id)
  longPressNodes.remove(id)
  doublePressNodes.remove(id)
  activePressNodes.remove(id)
  longPressFired.remove(id)
  longPressDurations.remove(id)
  doublePressWindows.remove(id)
  lastPressTimestamps.remove(id)
  pressLocalPoints.remove(id)
  pressScreenPoints.remove(id)
  layoutNodes.remove(id)
  layoutPending.remove(id)
  layoutFrames.remove(id)
  nodeSurfaces.remove(id)
  val runnable = longPressRunnables.remove(id)
  if (runnable != null) {
    mainHandler.removeCallbacks(runnable)
  }
  val listener = touchListeners.remove(id)
  val view = nodes[id]
  if (listener != null && view != null) {
    runOnMain { view.setOnTouchListener(null) }
  }
}
