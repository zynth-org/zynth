package com.rune.kit.core

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import com.rune.kit.layout.Style

internal data class ButtonVisualStyle(
  val backgroundColor: Int?,
  val cornerRadius: Float?,
  val paddingLeft: Int,
  val paddingTop: Int,
  val paddingRight: Int,
  val paddingBottom: Int,
  val minWidth: Int?,
  val minHeight: Int?,
)

internal fun deriveButtonVisualStyle(
  style: Style,
  current: ButtonVisualStyle?,
  fallback: RuneButtonView,
): ButtonVisualStyle {
  val paddingBase = style.padding?.toInt()
  val horizontal = style.paddingHorizontal?.toInt()
  val vertical = style.paddingVertical?.toInt()

  val left = style.paddingLeft?.toInt()
    ?: horizontal
    ?: paddingBase
    ?: current?.paddingLeft
    ?: 0
  val right = style.paddingRight?.toInt()
    ?: horizontal
    ?: paddingBase
    ?: current?.paddingRight
    ?: 0
  val top = style.paddingTop?.toInt()
    ?: vertical
    ?: paddingBase
    ?: current?.paddingTop
    ?: 0
  val bottom = style.paddingBottom?.toInt()
    ?: vertical
    ?: paddingBase
    ?: current?.paddingBottom
    ?: 0

  val minWidth = style.minWidth?.toInt() ?: current?.minWidth
  val minHeight = style.minHeight?.toInt() ?: current?.minHeight

  val existingColor = when (val bg = fallback.background) {
    is ColorDrawable -> bg.color
    is GradientDrawable -> {
      runCatching {
        val field = GradientDrawable::class.java.getDeclaredField("mColorStateList")
        field.isAccessible = true
        val stateList = field.get(bg) as? android.content.res.ColorStateList
        stateList?.defaultColor
      }.getOrNull()
    }
    else -> null
  }

  val fallbackCorner =
    (fallback.background as? GradientDrawable)?.cornerRadius ?: current?.cornerRadius

  return ButtonVisualStyle(
    backgroundColor = style.backgroundColor ?: current?.backgroundColor ?: existingColor,
    cornerRadius = style.borderRadius ?: fallbackCorner,
    paddingLeft = left,
    paddingTop = top,
    paddingRight = right,
    paddingBottom = bottom,
    minWidth = minWidth,
    minHeight = minHeight,
  )
}

internal fun applyVisualStyle(button: RuneButtonView, visualStyle: ButtonVisualStyle) {
  val drawable = ((button.background as? GradientDrawable)?.mutate() as? GradientDrawable)
    ?: GradientDrawable()
  drawable.setColor(visualStyle.backgroundColor ?: Color.TRANSPARENT)
  visualStyle.cornerRadius?.let { drawable.setCornerRadius(it) }
  button.background = drawable

  button.setPadding(
    visualStyle.paddingLeft,
    visualStyle.paddingTop,
    visualStyle.paddingRight,
    visualStyle.paddingBottom,
  )

  visualStyle.minWidth?.let { button.minimumWidth = it }
  visualStyle.minHeight?.let { button.minimumHeight = it }
  button.requestLayout()
  button.invalidate()
}
