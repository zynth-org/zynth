package com.zynth.kit.core

import android.content.Context
import android.graphics.Rect
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import java.util.concurrent.atomic.AtomicInteger

class ZynthRootView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
  explicitRootId: Int? = null,
) : ZynthLayoutView(context, attrs, defStyleAttr) {
  val rootId: Int = explicitRootId ?: allocateRootId()

  constructor(context: Context, explicitRootId: Int) : this(context, null, 0, explicitRootId)

  companion object {
    private const val SURFACE_ID_OFFSET = 1 shl 20
    private val NEXT_ROOT_ID = AtomicInteger(SURFACE_ID_OFFSET)

    @JvmStatic
    fun allocateRootId(): Int = NEXT_ROOT_ID.getAndIncrement()
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
}
