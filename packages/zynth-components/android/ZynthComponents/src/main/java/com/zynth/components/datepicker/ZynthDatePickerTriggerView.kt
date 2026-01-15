package com.zynth.components.datepicker

import android.content.Context
import android.view.MotionEvent
import android.widget.FrameLayout

class ZynthDatePickerTriggerView(context: Context) : FrameLayout(context) {
  var datePickerView: ZynthDatePickerView? = null

  init {
    isClickable = true
    isFocusable = true
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    return datePickerView != null
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (datePickerView == null) return super.onTouchEvent(event)
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
    datePickerView?.showPicker()
    return true
  }

  fun reset() {
    datePickerView = null
  }
}
