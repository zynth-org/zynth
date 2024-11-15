package com.rune.kit.core

import android.graphics.Outline
import android.view.View
import android.view.ViewOutlineProvider

class RoundedOutline(private val radius: Float) : ViewOutlineProvider() {
  override fun getOutline(view: View, outline: Outline) {
    outline.setRoundRect(0, 0, view.width, view.height, radius)
  }
}
