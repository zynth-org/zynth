package com.zynth.components.view

import android.content.Context
import android.graphics.Canvas
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import com.zynth.kit.core.ZynthLayoutView
import com.zynth.kit.core.ZynthUIManager

/**
 * Custom FrameLayout for the View component.
 * Handles pointer events, user interaction modes, and overflow clipping.
 * 
 * Overflow clipping is implemented via canvas clipping in dispatchDraw(),
 * NOT via clipChildren/clipBounds. This ensures that:
 * - overflow:hidden only clips direct children to THIS view's bounds
 * - Nested views with overflow:visible can still render outside their parent
 * - Similar to React Native's ReactViewGroup implementation
 */
open class ZynthViewContainer(context: Context) : ZynthLayoutView(context) {

  var manager: ZynthUIManager? = null
  var nodeId: Int = -1
  var hasOnPressHandler: Boolean = false
  
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
      PointerEventsMode.NONE -> true
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

