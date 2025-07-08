package com.rune.components.progressindicator

import android.content.Context
import android.graphics.Color
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.widget.FrameLayout
import com.google.android.material.progressindicator.CircularProgressIndicator
import kotlin.math.roundToInt

/**
 * A native Material 3 circular progress indicator for Rune.
 * 
 * Supports:
 * - Two sizes: "small" (24dp) and "large" (48dp)
 * - Custom color via hex string
 * - Animation control (start/stop)
 */
class RuneProgressIndicatorView(context: Context) : FrameLayout(context) {

  var nodeId: Int = -1

  private val indicator: CircularProgressIndicator
  private val density = resources.displayMetrics.density

  private var currentSize: String = "small"
  private var customColor: Int? = null

  companion object {
    private const val TAG = "ProgressIndicator"
    private const val SIZE_SMALL_DP = 24
    private const val SIZE_LARGE_DP = 48
    private const val TRACK_THICKNESS_SMALL_DP = 3
    private const val TRACK_THICKNESS_LARGE_DP = 4
  }

  init {
    indicator = CircularProgressIndicator(context).apply {
      isIndeterminate = true
      trackCornerRadius = (2 * density).roundToInt()
      // Ensure visible by default
      visibility = View.VISIBLE
    }

    // Apply default size first (sets indicator dimensions)
    applySize("small")
    
    // Add indicator with proper layout params
    val sizePx = (SIZE_SMALL_DP * density).roundToInt()
    addView(indicator, LayoutParams(sizePx, sizePx))
    
    // Start animating immediately
    indicator.show()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Measure the indicator child
    measureChildren(widthMeasureSpec, heightMeasureSpec)
    
    // Get the size based on current mode
    val sizeDp = when (currentSize) {
      "large" -> SIZE_LARGE_DP
      else -> SIZE_SMALL_DP
    }
    val sizePx = (sizeDp * density).roundToInt()
    
    // Resolve the final dimensions respecting the measure specs
    val width = resolveSize(sizePx, widthMeasureSpec)
    val height = resolveSize(sizePx, heightMeasureSpec)
    
    setMeasuredDimension(width, height)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    
    // Center the indicator within the frame
    val childWidth = indicator.measuredWidth
    val childHeight = indicator.measuredHeight
    val childLeft = (width - childWidth) / 2
    val childTop = (height - childHeight) / 2
    
    indicator.layout(childLeft, childTop, childLeft + childWidth, childTop + childHeight)
  }

  fun setColor(colorString: String?) {
    val color = colorString?.let { parseColor(it) }
    customColor = color
    
    if (color != null) {
      indicator.setIndicatorColor(color)
      // Make the track transparent or semi-transparent
      indicator.trackColor = Color.argb(40, Color.red(color), Color.green(color), Color.blue(color))
      indicator.invalidate()
    } else {
      // Reset to default theme colors
      val typedValue = TypedValue()
      context.theme.resolveAttribute(com.google.android.material.R.attr.colorPrimary, typedValue, true)
      indicator.setIndicatorColor(typedValue.data)
      indicator.trackColor = Color.argb(40, Color.red(typedValue.data), Color.green(typedValue.data), Color.blue(typedValue.data))
    }
  }

  fun setSize(size: String?) {
    val sizeValue = size ?: "small"
    // Always apply size to ensure it's set correctly
    currentSize = sizeValue
    applySize(sizeValue)
    requestLayout()
  }

  fun setAnimating(animating: Boolean) {
    if (animating) {
      indicator.visibility = View.VISIBLE
      indicator.show()
    } else {
      indicator.hide()
    }
  }

  private fun applySize(size: String) {
    val (sizeDp, thicknessDp) = when (size) {
      "large" -> SIZE_LARGE_DP to TRACK_THICKNESS_LARGE_DP
      else -> SIZE_SMALL_DP to TRACK_THICKNESS_SMALL_DP
    }

    val sizePx = (sizeDp * density).roundToInt()
    val thicknessPx = (thicknessDp * density).roundToInt()

    indicator.indicatorSize = sizePx
    indicator.trackThickness = thicknessPx
    indicator.layoutParams = LayoutParams(sizePx, sizePx)

    // Re-apply custom color if set
    customColor?.let {
      indicator.setIndicatorColor(it)
      indicator.trackColor = Color.argb(40, Color.red(it), Color.green(it), Color.blue(it))
    }
  }

  private fun parseColor(colorStr: String): Int? {
    return try {
      when {
        colorStr.startsWith("#") -> Color.parseColor(colorStr)
        colorStr.startsWith("rgba(") -> parseRgba(colorStr)
        colorStr.startsWith("rgb(") -> parseRgb(colorStr)
        else -> Color.parseColor("#$colorStr")
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun parseRgba(rgba: String): Int {
    val values = rgba.removePrefix("rgba(").removeSuffix(")").split(",").map { it.trim() }
    val r = values[0].toInt()
    val g = values[1].toInt()
    val b = values[2].toInt()
    val a = (values[3].toFloat() * 255).roundToInt()
    return Color.argb(a, r, g, b)
  }

  private fun parseRgb(rgb: String): Int {
    val values = rgb.removePrefix("rgb(").removeSuffix(")").split(",").map { it.trim() }
    val r = values[0].toInt()
    val g = values[1].toInt()
    val b = values[2].toInt()
    return Color.rgb(r, g, b)
  }
}
