package com.zynth.components.menu

import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.FrameLayout
import kotlin.math.abs

class ZynthMenuTriggerView(context: Context) : FrameLayout(context) {
  companion object {
    const val OPEN_ON_PRESS = "press"
    const val OPEN_ON_LONG_PRESS = "longPress"
  }

  var menuView: ZynthMenuView? = null
  private var openOn = OPEN_ON_PRESS
  private val longPressTimeoutMs = ViewConfiguration.getLongPressTimeout().toLong()
  private val touchSlopPx = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
  private var longPressRunnable: Runnable? = null
  private var downX = 0f
  private var downY = 0f
  private var longPressTriggered = false

  init {
    isClickable = true
    isFocusable = true
    isLongClickable = true
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    return menuView != null
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (menuView == null) return super.onTouchEvent(event)
    return when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        longPressTriggered = false
        if (openOn == OPEN_ON_LONG_PRESS) {
          scheduleLongPress()
        } else {
          cancelLongPressTimer()
        }
        true
      }
      MotionEvent.ACTION_MOVE -> {
        if (openOn == OPEN_ON_LONG_PRESS && movedBeyondTouchSlop(event)) {
          cancelLongPressTimer()
        }
        true
      }
      MotionEvent.ACTION_UP -> {
        cancelLongPressTimer()
        if (openOn == OPEN_ON_PRESS) {
          performClick()
        }
        longPressTriggered = false
        true
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelLongPressTimer()
        longPressTriggered = false
        true
      }
      else -> true
    }
  }

  private fun movedBeyondTouchSlop(event: MotionEvent): Boolean {
    return abs(event.x - downX) > touchSlopPx || abs(event.y - downY) > touchSlopPx
  }

  private fun scheduleLongPress() {
    cancelLongPressTimer()
    longPressRunnable = Runnable {
      if (menuView == null) return@Runnable
      longPressTriggered = true
      performLongClick()
    }
    postDelayed(longPressRunnable!!, longPressTimeoutMs)
  }

  private fun cancelLongPressTimer() {
    longPressRunnable?.let { removeCallbacks(it) }
    longPressRunnable = null
  }

  override fun performLongClick(): Boolean {
    super.performLongClick()
    if (menuView == null) return false
    if (openOn != OPEN_ON_LONG_PRESS || longPressTriggered.not()) return false
    menuView?.showMenuFromTrigger(this)
    return true
  }

  override fun performClick(): Boolean {
    super.performClick()
    if (menuView == null) return false
    if (openOn != OPEN_ON_PRESS) return false
    menuView?.showMenuFromTrigger(this)
    return true
  }

  fun setOpenOn(value: String?) {
    openOn = if (value == OPEN_ON_LONG_PRESS || value == "onLongPress") {
      OPEN_ON_LONG_PRESS
    } else {
      OPEN_ON_PRESS
    }
  }

  fun reset() {
    cancelLongPressTimer()
    longPressTriggered = false
    openOn = OPEN_ON_PRESS
    menuView = null
  }
}
