package com.rune.components.menu

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.text.TextPaint
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import com.rune.kit.core.RuneUIManager
import kotlin.math.ceil

class RuneMenuItemView(context: Context) : FrameLayout(context) {
  var nodeId: Int = -1
  var manager: RuneUIManager? = null
  var hasOnPressHandler: Boolean = false

  var label: String? = null
  var destructive: Boolean = false
  var disabled: Boolean = false

  init {
    visibility = View.GONE
    isClickable = false
    isFocusable = false
  }

  fun createIconDrawable(): Drawable? {
    val textView = findTextView(this) ?: return null
    val text = textView.text?.toString() ?: return null
    if (text.isEmpty()) return null

    val paint = TextPaint(textView.paint)
    paint.isAntiAlias = true
    val metrics = paint.fontMetrics
    val width = ceil(paint.measureText(text)).toInt().coerceAtLeast(1)
    val height = ceil(metrics.descent - metrics.ascent).toInt().coerceAtLeast(1)

    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawText(text, 0f, -metrics.ascent, paint)
    return BitmapDrawable(resources, bitmap)
  }

  private fun findTextView(view: View): TextView? {
    if (view is TextView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        val result = findTextView(view.getChildAt(i))
        if (result != null) return result
      }
    }
    return null
  }

  fun reset() {
    label = null
    destructive = false
    disabled = false
    hasOnPressHandler = false
    manager = null
    nodeId = -1
  }
}
