package com.zynth.kit.core

import android.content.Context
import android.util.AttributeSet
import android.widget.FrameLayout

open class ZynthLayoutView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {
  private var yogaWidth = -1
  private var yogaHeight = -1

  init {
    clipChildren = false
    clipToPadding = false
    clipToOutline = false
  }

  fun updateYogaLayout(width: Int, height: Int) {
    yogaWidth = width
    yogaHeight = height
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val measuredWidth = if (yogaWidth >= 0) {
      yogaWidth
    } else {
      MeasureSpec.getSize(widthMeasureSpec)
    }
    val measuredHeight = if (yogaHeight >= 0) {
      yogaHeight
    } else {
      MeasureSpec.getSize(heightMeasureSpec)
    }
    setMeasuredDimension(measuredWidth, measuredHeight)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // Yoga drives layout via explicit view.layout calls.
  }
}
