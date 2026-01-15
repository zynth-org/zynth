package com.zynth.components.slider

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.widget.FrameLayout
import com.google.android.material.slider.Slider
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Native Material 3 Slider for Zynth.
 *
 * Supports:
 * - Controlled value with min/max bounds
 * - Optional step snapping
 * - Disabled state
 * - Custom thumb / track colors
 * - onValueChange and onSlidingComplete callbacks
 */
class ZynthSliderView(context: Context) : FrameLayout(context) {

  var nodeId: Int = -1

  /** Listener invoked for value changes */
  var listener: Listener? = null

  private val slider: Slider
  private var isUpdatingFromJs = false
  private var isTracking = false
  interface Listener {
    fun onValueChange(nodeId: Int, value: Float, isFinal: Boolean)
    fun onSlidingComplete(nodeId: Int, value: Float)
  }

  init {
    clipChildren = false
    clipToPadding = false

    slider = Slider(context).apply {
      valueFrom = 0f
      valueTo = 1f
      value = 0f

      addOnChangeListener { _, rawValue, fromUser ->
        if (isUpdatingFromJs) return@addOnChangeListener

        if (fromUser) {
          listener?.onValueChange(nodeId, rawValue, false)
        }
      }

      addOnSliderTouchListener(object : Slider.OnSliderTouchListener {
        override fun onStartTrackingTouch(slider: Slider) {
          isTracking = true
        }

        override fun onStopTrackingTouch(slider: Slider) {
          isTracking = false
          if (isUpdatingFromJs) return
          val snapped = snapToStep(slider.value)
          if (snapped != slider.value) {
            isUpdatingFromJs = true
            slider.value = snapped
            isUpdatingFromJs = false
          }
          listener?.onValueChange(nodeId, snapped, true)
          listener?.onSlidingComplete(nodeId, snapped)
        }
      })
    }

    addView(
      slider,
      LayoutParams(
        LayoutParams.MATCH_PARENT,
        LayoutParams.WRAP_CONTENT,
      ),
    )
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    measureChildren(widthMeasureSpec, heightMeasureSpec)
    val childWidth = slider.measuredWidth
    val childHeight = slider.measuredHeight

    val measuredWidth = resolveSize(childWidth, widthMeasureSpec)
    val measuredHeight = resolveSize(childHeight, heightMeasureSpec)
    setMeasuredDimension(measuredWidth, measuredHeight)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top

    val childHeight = slider.measuredHeight
    val childTop = (height - childHeight) / 2
    slider.layout(0, childTop, width, childTop + childHeight)
  }

  fun setRange(minValue: Float, maxValue: Float) {
    val safeMin = min(minValue, maxValue)
    val safeMax = max(minValue, maxValue)
    slider.valueFrom = safeMin
    slider.valueTo = safeMax
    setValue(slider.value, forceDuringTracking = true) // clamp current value if needed
  }

  fun minValue(): Float = slider.valueFrom

  fun maxValue(): Float = slider.valueTo

  fun currentValue(): Float = slider.value

  fun setStep(step: Float?) {
    slider.stepSize = step?.takeIf { it > 0f } ?: 0f
    // Ensure current value aligns with the new step to avoid Material validation crashes
    setValue(slider.value, forceDuringTracking = true)
  }

  fun setValue(next: Float, forceDuringTracking: Boolean = false) {
    if (isTracking && !forceDuringTracking) return
    val snapped = snapToStep(next)
    if (slider.value != snapped) {
      isUpdatingFromJs = true
      slider.value = snapped
      isUpdatingFromJs = false
    }
  }

  fun setDisabled(disabled: Boolean) {
    slider.isEnabled = !disabled
    slider.alpha = if (disabled) 0.5f else 1.0f
  }

  fun setMinimumTrackColor(colorString: String?) {
    val color = parseColor(colorString)
    if (color != null) {
      slider.setTrackActiveTintList(ColorStateList.valueOf(color))
    }
  }

  fun setMaximumTrackColor(colorString: String?) {
    val color = parseColor(colorString)
    if (color != null) {
      slider.setTrackInactiveTintList(ColorStateList.valueOf(color))
    }
  }

  fun setThumbTintColor(colorString: String?) {
    val color = parseColor(colorString)
    if (color != null) {
      slider.setThumbTintList(ColorStateList.valueOf(color))
    }
  }

  private fun snapToStep(value: Float): Float {
    val step = slider.stepSize
    val minValue = slider.valueFrom
    val maxValue = slider.valueTo
    val clamped = value.coerceIn(minValue, maxValue)
    if (step <= 0f) return clamped
    val steps = ((clamped - minValue) / step).roundToInt()
    val snapped = minValue + (steps * step)
    return snapped.coerceIn(minValue, maxValue)
  }

  private fun parseColor(colorStr: String?): Int? {
    if (colorStr == null) return null
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
