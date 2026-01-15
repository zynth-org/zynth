package com.zynth.kit.core

import android.view.View
import com.zynth.kit.layout.TransformOrigin

internal object TransformOriginApplier {
  fun apply(view: View, origin: TransformOrigin?, width: Int = view.width, height: Int = view.height) {
    val resolvedWidth = if (width < 0) 0 else width
    val resolvedHeight = if (height < 0) 0 else height
    if (origin == null) {
      view.pivotX = resolvedWidth / 2f
      view.pivotY = resolvedHeight / 2f
      return
    }
    view.pivotX = origin.x.resolve(resolvedWidth)
    view.pivotY = origin.y.resolve(resolvedHeight)
  }
}
