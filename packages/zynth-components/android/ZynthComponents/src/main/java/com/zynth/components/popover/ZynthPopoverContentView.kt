package com.zynth.components.popover

import android.content.Context
import android.view.View
import android.widget.FrameLayout

class ZynthPopoverContentView(context: Context) : FrameLayout(context) {
  init {
    clipChildren = false
    clipToPadding = false
    setParked(true)
  }

  fun setParked(value: Boolean) {
    // Parked content must be fully out of layout and hit-testing, otherwise it
    // can reserve space inline and block trigger touches.
    visibility = if (value) View.GONE else View.VISIBLE
    alpha = if (value) 0f else 1f
    isEnabled = !value
    isClickable = !value
    isFocusable = !value
    isFocusableInTouchMode = !value
    importantForAccessibility = if (value) {
      View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    } else {
      View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    }
  }

  fun reset() {
    setParked(true)
  }
}
