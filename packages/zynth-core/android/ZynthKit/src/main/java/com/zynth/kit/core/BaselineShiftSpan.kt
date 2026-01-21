package com.zynth.kit.core

import android.text.TextPaint
import android.text.style.MetricAffectingSpan

class BaselineShiftSpan(private val shiftPx: Float) : MetricAffectingSpan() {
  override fun updateDrawState(tp: TextPaint) {
    tp.baselineShift += shiftPx.toInt()
  }

  override fun updateMeasureState(tp: TextPaint) {
    tp.baselineShift += shiftPx.toInt()
  }
}
