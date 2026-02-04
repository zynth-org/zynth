package com.zynth.kit.core

import android.content.Context
import android.util.AttributeSet
import android.graphics.Canvas
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
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

  private var overflowHidden: Boolean = false
  private var clipPath: Path? = null
  private var clipRect: RectF? = null
  private var pathDirty = true
  
  protected var borderTopLeftRadius: Float = 0f
  protected var borderTopRightRadius: Float = 0f
  protected var borderBottomRightRadius: Float = 0f
  protected var borderBottomLeftRadius: Float = 0f

  init {
    clipChildren = false
    clipToPadding = false
    clipToOutline = false
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
      outlineProvider = object : android.view.ViewOutlineProvider() {
        override fun getOutline(view: View, outline: android.graphics.Outline) {
          val hasUniformRadius = borderTopLeftRadius == borderTopRightRadius &&
                                 borderTopLeftRadius == borderBottomRightRadius &&
                                 borderTopLeftRadius == borderBottomLeftRadius
          if (hasUniformRadius && borderTopLeftRadius > 0f) {
            outline.setRoundRect(0, 0, view.width, view.height, borderTopLeftRadius)
          } else {
            outline.setRect(0, 0, view.width, view.height)
          }
          outline.alpha = 1.0f
        }
      }
    }
  }

  open fun setOverflowHidden(hidden: Boolean) {
    if (overflowHidden != hidden) {
      overflowHidden = hidden
      clipChildren = hidden
      clipToPadding = hidden
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
        val hasUniformRadius = borderTopLeftRadius == borderTopRightRadius &&
                               borderTopLeftRadius == borderBottomRightRadius &&
                               borderTopLeftRadius == borderBottomLeftRadius
        clipToOutline = hidden && hasUniformRadius
        invalidateOutline()
      }
      invalidate()
    }
  }

  open fun setBorderRadii(tl: Float, tr: Float, br: Float, bl: Float) {
    if (borderTopLeftRadius != tl || borderTopRightRadius != tr || 
        borderBottomRightRadius != br || borderBottomLeftRadius != bl) {
      borderTopLeftRadius = tl
      borderTopRightRadius = tr
      borderBottomRightRadius = br
      borderBottomLeftRadius = bl
      pathDirty = true
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
        val hasUniformRadius = borderTopLeftRadius == borderTopRightRadius &&
                               borderTopLeftRadius == borderBottomRightRadius &&
                               borderTopLeftRadius == borderBottomLeftRadius
        clipToOutline = overflowHidden && hasUniformRadius
        invalidateOutline()
      }
      invalidate()
    }
  }

  private fun updateClipPath() {
    if (!pathDirty && clipPath != null) return
    
    var path = clipPath
    if (path == null) {
      path = Path()
      clipPath = path
    }
    path.reset()
    
    val hasRadius = borderTopLeftRadius > 0f || borderTopRightRadius > 0f || 
                    borderBottomRightRadius > 0f || borderBottomLeftRadius > 0f
                    
    if (hasRadius) {
      val radii = floatArrayOf(
        borderTopLeftRadius, borderTopLeftRadius,
        borderTopRightRadius, borderTopRightRadius,
        borderBottomRightRadius, borderBottomRightRadius,
        borderBottomLeftRadius, borderBottomLeftRadius
      )
      path.addRoundRect(
        RectF(0f, 0f, width.toFloat(), height.toFloat()),
        radii,
        Path.Direction.CW
      )
    } else {
      path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
    }
    pathDirty = false
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

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    pathDirty = true
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
      invalidateOutline()
    }
  }

  override fun dispatchDraw(canvas: Canvas) {
    val borderDrawable = background as? ZynthBorderDrawable
    if (overflowHidden && width > 0 && height > 0 && !clipToOutline) {
      val saveCount = canvas.save()
      
      val hasRadius = borderTopLeftRadius > 0f || borderTopRightRadius > 0f || 
                      borderBottomRightRadius > 0f || borderBottomLeftRadius > 0f
      
      if (hasRadius) {
        updateClipPath()
        clipPath?.let { canvas.clipPath(it) }
      } else {
        val rect = getOrCreateClipRect()
        canvas.clipRect(rect.left, rect.top, rect.right, rect.bottom)
      }
      
      super.dispatchDraw(canvas)
      canvas.restoreToCount(saveCount)
    } else {
      super.dispatchDraw(canvas)
    }
    borderDrawable?.drawBorder(canvas)
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
    if (onInterceptTouchEvent(ev)) {
      return super.dispatchTouchEvent(ev)
    }
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
