package com.rune.components.switch

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.widget.FrameLayout
import com.google.android.material.materialswitch.MaterialSwitch
import kotlin.math.roundToInt

/**
 * A native Material 3 Switch for Rune.
 * 
 * Supports:
 * - On/off state
 * - Disabled state
 * - Custom track color (when on)
 * - Custom thumb color
 */
class RuneSwitchView(context: Context) : FrameLayout(context) {

  var nodeId: Int = -1
  
  /** Listener for switch value changes */
  var listener: Listener? = null

  private val materialSwitch: MaterialSwitch
  private val density = resources.displayMetrics.density

  private var customTrackColor: Int? = null
  private var customThumbColor: Int? = null

  interface Listener {
    fun onValueChange(nodeId: Int, value: Boolean)
  }

  companion object {
    private const val TAG = "RuneSwitchView"
    // Extra padding to prevent the state layer ripple from being clipped
    private const val RIPPLE_PADDING_DP = 4
  }

  init {
    // Allow the ripple/state layer effect to overflow the container bounds
    clipChildren = false
    clipToPadding = false
    
    materialSwitch = MaterialSwitch(context).apply {
      isChecked = false
      // Listen for user-initiated changes
      setOnCheckedChangeListener { _, isChecked ->
        listener?.onValueChange(nodeId, isChecked)
      }
    }

    addView(materialSwitch, LayoutParams(
      LayoutParams.WRAP_CONTENT,
      LayoutParams.WRAP_CONTENT
    ))
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Measure the switch child
    measureChildren(widthMeasureSpec, heightMeasureSpec)
    
    // Add padding for the ripple/state layer effect
    val ripplePadding = (RIPPLE_PADDING_DP * density).roundToInt()
    val childWidth = materialSwitch.measuredWidth + (ripplePadding * 2)
    val childHeight = materialSwitch.measuredHeight + (ripplePadding * 2)
    
    // Resolve the final dimensions respecting the measure specs
    val width = resolveSize(childWidth, widthMeasureSpec)
    val height = resolveSize(childHeight, heightMeasureSpec)
    
    setMeasuredDimension(width, height)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    
    // Center the switch within the frame (accounting for ripple padding)
    val childWidth = materialSwitch.measuredWidth
    val childHeight = materialSwitch.measuredHeight
    val childLeft = (width - childWidth) / 2
    val childTop = (height - childHeight) / 2
    
    materialSwitch.layout(childLeft, childTop, childLeft + childWidth, childTop + childHeight)
  }

  /**
   * Sets the switch value without triggering the listener.
   */
  fun setValue(value: Boolean) {
    if (materialSwitch.isChecked != value) {
      // Temporarily remove listener to avoid feedback loop
      materialSwitch.setOnCheckedChangeListener(null)
      materialSwitch.isChecked = value
      // Restore listener
      materialSwitch.setOnCheckedChangeListener { _, isChecked ->
        listener?.onValueChange(nodeId, isChecked)
      }
    }
  }

  fun setDisabled(disabled: Boolean) {
    materialSwitch.isEnabled = !disabled
    materialSwitch.alpha = if (disabled) 0.5f else 1.0f
  }

  fun setTrackColor(colorString: String?) {
    val color = colorString?.let { parseColor(it) }
    customTrackColor = color
    
    if (color != null) {
      // Set track color for checked state
      val states = arrayOf(
        intArrayOf(android.R.attr.state_checked),
        intArrayOf(-android.R.attr.state_checked)
      )
      val trackColors = intArrayOf(
        color,
        // Use a lighter version for unchecked state
        Color.argb(60, Color.red(color), Color.green(color), Color.blue(color))
      )
      materialSwitch.trackTintList = ColorStateList(states, trackColors)
    } else {
      // Reset to default
      materialSwitch.trackTintList = null
    }
  }

  fun setThumbColor(colorString: String?) {
    val color = colorString?.let { parseColor(it) }
    customThumbColor = color
    
    if (color != null) {
      materialSwitch.thumbTintList = ColorStateList.valueOf(color)
    } else {
      // Reset to default
      materialSwitch.thumbTintList = null
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
