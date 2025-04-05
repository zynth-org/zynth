package com.rune.components.view

import android.content.Context
import android.view.MotionEvent
import android.widget.FrameLayout

/**
 * Custom FrameLayout for the View component.
 * Handles pointer events and user interaction modes.
 */
class RuneViewContainer(context: Context) : FrameLayout(context) {
  
  enum class PointerEventsMode {
    AUTO,        // Default - handle events normally
    NONE,        // Don't handle any events (pass through completely)
    BOX_NONE,    // Pass through to children but not the box itself
    BOX_ONLY     // Handle events on box but not children
  }
  
  var pointerMode: PointerEventsMode = PointerEventsMode.AUTO
    set(value) {
      field = value
      updateInteractionState()
    }
  
  private fun updateInteractionState() {
    when (pointerMode) {
      PointerEventsMode.NONE -> {
        isClickable = false
        isFocusable = false
      }
      PointerEventsMode.BOX_NONE -> {
        isClickable = false
        isFocusable = false
      }
      PointerEventsMode.BOX_ONLY -> {
        isClickable = true
        isFocusable = true
      }
      PointerEventsMode.AUTO -> {
        // Keep current clickable state
      }
    }
  }
  
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    return when (pointerMode) {
      PointerEventsMode.NONE -> false
      PointerEventsMode.BOX_NONE -> false
      PointerEventsMode.BOX_ONLY -> true
      PointerEventsMode.AUTO -> super.onInterceptTouchEvent(ev)
    }
  }
  
  override fun onTouchEvent(event: MotionEvent): Boolean {
    return when (pointerMode) {
      PointerEventsMode.NONE -> false
      PointerEventsMode.BOX_NONE -> false
      PointerEventsMode.BOX_ONLY -> super.onTouchEvent(event)
      PointerEventsMode.AUTO -> super.onTouchEvent(event)
    }
  }
}
