package com.zynth.components.popover

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import kotlin.math.max

class ZynthPopoverContentView(context: Context) : FrameLayout(context) {
  private var parked = true

  init {
    clipChildren = false
    clipToPadding = false
    setParked(true)
  }

  fun setParked(value: Boolean) {
    parked = value
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

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    if (parked) {
      setMeasuredDimension(0, 0)
      return
    }

    val childWidthSpec = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
    val childHeightSpec = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)

    var maxRight = paddingLeft + paddingRight
    var maxBottom = paddingTop + paddingBottom

    for (index in 0 until childCount) {
      val child = getChildAt(index)
      if (child.visibility == View.GONE) continue

      child.measure(childWidthSpec, childHeightSpec)

      val childWidth = max(child.measuredWidth, child.right - child.left)
      val childHeight = max(child.measuredHeight, child.bottom - child.top)
      val childRight = paddingLeft + child.left + childWidth
      val childBottom = paddingTop + child.top + childHeight

      if (childRight > maxRight) {
        maxRight = childRight + paddingRight
      }
      if (childBottom > maxBottom) {
        maxBottom = childBottom + paddingBottom
      }
    }

    setMeasuredDimension(
      resolveSize(maxRight.coerceAtLeast(suggestedMinimumWidth), widthMeasureSpec),
      resolveSize(maxBottom.coerceAtLeast(suggestedMinimumHeight), heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    for (index in 0 until childCount) {
      val child = getChildAt(index)
      child.layout(child.left, child.top, child.right, child.bottom)
    }
  }

  fun reset() {
    setParked(true)
  }
}
