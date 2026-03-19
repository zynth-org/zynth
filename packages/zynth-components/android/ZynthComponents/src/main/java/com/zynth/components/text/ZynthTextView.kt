package com.zynth.components.text

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import androidx.appcompat.widget.AppCompatTextView

/**
 * Custom TextView for the Text component.
 * Handles text composition from nested text nodes and styling.
 */
class ZynthTextView(context: Context) : AppCompatTextView(context) {
  init {
    textSize = 16f
    setTextColor(Color.BLACK) // Default to black text
    gravity = Gravity.START
    includeFontPadding = false
    setPadding(0, 0, 0, 0)
  }
}
