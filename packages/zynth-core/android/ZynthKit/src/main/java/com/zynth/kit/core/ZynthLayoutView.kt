package com.zynth.kit.core

import android.content.Context
import android.util.AttributeSet
import android.graphics.Rect
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
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

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    return when (ZynthPointerEvents.mode(this)) {
      ZynthPointerEvents.Mode.NONE -> true
      ZynthPointerEvents.Mode.BOX_ONLY -> true
      ZynthPointerEvents.Mode.BOX_NONE -> false
      else -> super.onInterceptTouchEvent(ev)
    }
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (childCount == 0) return super.dispatchTouchEvent(ev)
    val x = ev.x.toInt()
    val y = ev.y.toInt()
    val hit = Rect()
    for (i in childCount - 1 downTo 0) {
      val child = getChildAt(i)
      if (child.visibility != View.VISIBLE) continue
      child.getHitRect(hit)
      if (!hit.contains(x, y)) continue
      when (ZynthPointerEvents.mode(child)) {
        ZynthPointerEvents.Mode.NONE -> {
          continue
        }
        ZynthPointerEvents.Mode.BOX_NONE -> {
          if (child is ViewGroup) {
            if (dispatchToChild(child, ev)) return true
          }
          continue
        }
        ZynthPointerEvents.Mode.BOX_ONLY -> {
          val handled = dispatchToChild(child, ev)
          return handled || true
        }
        else -> {
          if (dispatchToChild(child, ev)) return true
          return false
        }
      }
    }
    return super.dispatchTouchEvent(ev)
  }

  private fun dispatchToChild(child: View, ev: MotionEvent): Boolean {
    val offsetX = scrollX - child.left
    val offsetY = scrollY - child.top
    ev.offsetLocation(offsetX.toFloat(), offsetY.toFloat())
    val handled = child.dispatchTouchEvent(ev)
    ev.offsetLocation(-offsetX.toFloat(), -offsetY.toFloat())
    return handled
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    return when (ZynthPointerEvents.mode(this)) {
      ZynthPointerEvents.Mode.NONE -> false
      ZynthPointerEvents.Mode.BOX_NONE -> false
      else -> super.onTouchEvent(event)
    }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // Yoga drives layout via explicit view.layout calls.
    // However, during Android layout passes (e.g. inside ScrollView), we must confirm children.
    for (i in 0 until childCount) {
      val child = getChildAt(i)
      child.layout(child.left, child.top, child.right, child.bottom)
    }
  }
}
