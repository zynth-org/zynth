package com.zynth.components.popover

import android.content.Context
import android.view.MotionEvent
import android.widget.FrameLayout

class ZynthPopoverTriggerView(context: Context) : FrameLayout(context) {
  var popoverView: ZynthPopoverView? = null

  init {
    isClickable = true
    isFocusable = true
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    return popoverView != null
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (popoverView == null) return super.onTouchEvent(event)
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
    popoverView?.showFromTrigger()
    return true
  }

  fun reset() {
    popoverView = null
  }
}
