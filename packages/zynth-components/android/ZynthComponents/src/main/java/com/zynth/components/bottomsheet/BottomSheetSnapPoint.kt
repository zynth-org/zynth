package com.zynth.components.bottomsheet

import android.util.DisplayMetrics
import android.util.TypedValue

/** Represents a snap point definition expressed as a percentage or absolute dp value. */
sealed interface BottomSheetSnapPoint {
  fun resolveHeight(maxHeight: Int, metrics: DisplayMetrics): Int

  data class Percent(val ratio: Float) : BottomSheetSnapPoint {
    override fun resolveHeight(maxHeight: Int, metrics: DisplayMetrics): Int {
      return (maxHeight * ratio).toInt().coerceAtLeast(0)
    }
  }

  data class Absolute(val dp: Float) : BottomSheetSnapPoint {
    override fun resolveHeight(maxHeight: Int, metrics: DisplayMetrics): Int {
      return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, metrics).toInt().coerceAtLeast(0)
    }
  }

  companion object {
    private val percentRegex = Regex("^([0-9]+(?:\\.[0-9]+)?)%$")

    fun parse(value: String?): BottomSheetSnapPoint? {
      if (value.isNullOrBlank()) return null
      val trimmed = value.trim()
      percentRegex.matchEntire(trimmed)?.groupValues?.getOrNull(1)?.toFloatOrNull()?.let {
        return Percent((it / 100f).coerceIn(0f, 1f))
      }
      return trimmed.toFloatOrNull()?.let { Absolute(it.coerceAtLeast(0f)) }
    }
  }
}
