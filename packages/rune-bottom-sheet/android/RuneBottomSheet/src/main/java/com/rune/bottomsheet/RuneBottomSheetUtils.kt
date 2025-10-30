package com.rune.bottomsheet

import android.content.Context
import android.os.Build
import android.util.DisplayMetrics
import android.util.TypedValue
import android.view.WindowManager

object RuneBottomSheetUtils {
  fun toPixel(dip: Double, resources: android.content.res.Resources): Float =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dip.toFloat(), resources.displayMetrics)

  fun toDIP(px: Float, resources: android.content.res.Resources): Float {
    val density = resources.displayMetrics.density
    return if (density > 0f) px / density else px
  }

  fun screenHeight(context: Context): Int {
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // Use currentWindowMetrics on API 30+ which is the recommended API for window bounds
      windowManager?.currentWindowMetrics?.bounds?.height()
        ?: context.resources.displayMetrics.heightPixels
    } else {
      val metrics = DisplayMetrics()
      @Suppress("DEPRECATION")
      windowManager?.defaultDisplay?.getMetrics(metrics)
      metrics.heightPixels
    }
  }
}
