package com.rune.kit.core

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Looper
import android.view.View
import android.widget.FrameLayout
import com.rune.kit.debug.RuneRedBoxView
import java.util.concurrent.atomic.AtomicInteger

class RuneRootView @JvmOverloads constructor(
  ctx: Context,
  explicitRootId: Int? = null,
) : FrameLayout(ctx) {
  val rootId: Int = explicitRootId ?: NEXT_ROOT_ID.getAndIncrement()

  private val redBox = RuneRedBoxView(ctx).apply {
    visibility = View.GONE
  }

  init {
    addView(redBox, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun showRedBox(message: String, stack: String?) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      post { showRedBox(message, stack) }
      return
    }
    redBox.setError(message, stack)
    redBox.setOnDismissListener { hideRedBox() }
    redBox.setOnCloseAppListener {
      findHostActivity()?.finish()
      hideRedBox()
    }
    redBox.visibility = View.VISIBLE
    redBox.bringToFront()
  }

  fun hideRedBox() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      post { hideRedBox() }
      return
    }
    redBox.visibility = View.GONE
  }

  private fun findHostActivity(): Activity? {
    var context: Context? = context
    while (context is ContextWrapper) {
      if (context is Activity) {
        return context
      }
      context = context.baseContext
    }
    return null
  }

  companion object {
    private val NEXT_ROOT_ID = AtomicInteger(1)

    fun allocateRootId(): Int = NEXT_ROOT_ID.getAndIncrement()
  }
}
