package com.rune.components.view

import android.content.Context
import android.graphics.Canvas
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.widget.FrameLayout

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
open class RuneViewContainer(context: Context) : FrameLayout(context) {
  
  private var overflowHidden: Boolean = false
  private var clipPath: Path? = null
  private var clipRect: RectF? = null
  private var cornerRadius: Float = 0f
  
  init {
    // CRITICAL: Always keep clipChildren=false
    // This prevents Android's default behavior of clipping all descendants
    // We handle clipping manually in dispatchDraw() for CSS-like overflow behavior
    clipChildren = false
    clipToPadding = false
  }
  
  /**
   * Set overflow clipping behavior (CSS overflow: hidden/visible)
   */
  fun setOverflowHidden(hidden: Boolean) {
    if (overflowHidden != hidden) {
      overflowHidden = hidden
      invalidate()
    }
  }
  
  /**
   * Set corner radius for rounded clipping
   */
  fun setClipRadius(radius: Float) {
    if (cornerRadius != radius) {
      cornerRadius = radius
      clipPath = null  // Force recalculation
      invalidate()
    }
  }
  
  private fun getOrCreateClipPath(): Path {
    var path = clipPath
    if (path == null || path.isEmpty) {
      path = Path()
      clipPath = path
    }
    path.reset()
    
    if (cornerRadius > 0f) {
      path.addRoundRect(
        RectF(0f, 0f, width.toFloat(), height.toFloat()),
        cornerRadius,
        cornerRadius,
        Path.Direction.CW
      )
    } else {
      path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
    }
    return path
  }
  
  private fun getOrCreateClipRect(): RectF {
    var rect = clipRect
    if (rect == null) {
      rect = RectF()
      clipRect = rect
    }
    rect.set(0f, 0f, width.toFloat(), height.toFloat())
    return rect
  }
  
  override fun dispatchDraw(canvas: Canvas) {
    if (overflowHidden && width > 0 && height > 0) {
      // Save canvas state before clipping
      val saveCount = canvas.save()
      
      if (cornerRadius > 0f) {
        // Use path clipping for rounded corners
        canvas.clipPath(getOrCreateClipPath())
      } else {
        // Use rect clipping for simple rectangular overflow:hidden
        val rect = getOrCreateClipRect()
        canvas.clipRect(rect.left, rect.top, rect.right, rect.bottom)
      }
      
      // Draw children with clipping applied
      super.dispatchDraw(canvas)
      
      // Restore canvas to remove clipping for subsequent draws
      canvas.restoreToCount(saveCount)
    } else {
      // No clipping - draw normally
      super.dispatchDraw(canvas)
    }
  }
  
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
