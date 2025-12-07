package com.rune.components.menu

import android.content.Context
import android.view.MotionEvent
import android.widget.FrameLayout

class RuneMenuTriggerView(context: Context) : FrameLayout(context) {
  var menuView: RuneMenuView? = null

  init {
    isClickable = true
    isFocusable = true
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    return menuView != null
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (menuView == null) return super.onTouchEvent(event)
    return when (event.actionMasked) {
      MotionEvent.ACTION_UP -> {
        performClick()
        true
      }
      MotionEvent.ACTION_CANCEL -> true
      else -> true
    }
  }

  override fun performClick(): Boolean {
    super.performClick()
    menuView?.showMenuFromTrigger(this)
    return true
  }

  fun reset() {
    menuView = null
  }
}
