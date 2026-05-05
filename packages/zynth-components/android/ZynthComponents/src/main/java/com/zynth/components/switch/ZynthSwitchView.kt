package com.zynth.components.switch

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.widget.FrameLayout
import com.google.android.material.materialswitch.MaterialSwitch
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * A native Material 3 Switch for Zynth.
 * 
 * Supports:
 * - On/off state
 * - Disabled state
 * - Custom track color (when on)
 * - Custom thumb color
 */
class ZynthSwitchView(context: Context) : FrameLayout(context) {

  var nodeId: Int = -1
  
  /** Listener for switch value changes */
  var listener: Listener? = null

  private val materialSwitch: MaterialSwitch
  private val density = resources.displayMetrics.density

  private var customTrackColorOn: Int? = null
  private var customTrackColorOff: Int? = null
  private var customThumbColorOn: Int? = null
  private var customThumbColorOff: Int? = null

  interface Listener {
    fun onValueChange(nodeId: Int, value: Boolean)
  }

  companion object {
    private const val TAG = "ZynthSwitchView"
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
    // Measure the switch child with a WRAP_CONTENT approach
    val childWidthSpec = if (MeasureSpec.getMode(widthMeasureSpec) == MeasureSpec.UNSPECIFIED) {
      widthMeasureSpec
    } else {
      MeasureSpec.makeMeasureSpec(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.AT_MOST)
    }
    
    val childHeightSpec = if (MeasureSpec.getMode(heightMeasureSpec) == MeasureSpec.UNSPECIFIED) {
      heightMeasureSpec
    } else {
      MeasureSpec.makeMeasureSpec(MeasureSpec.getSize(heightMeasureSpec), MeasureSpec.AT_MOST)
    }

    materialSwitch.measure(childWidthSpec, childHeightSpec)
    
    // Add padding for the ripple/state layer effect
    val ripplePadding = (RIPPLE_PADDING_DP * density).roundToInt()
    
    // Fallback to standard Material 3 Switch dimensions if measurement returns 0
    // Standard M3 Switch is roughly 52dp x 32dp
    val minWidth = (52 * density).roundToInt()
    val minHeight = (32 * density).roundToInt()
    
    val childWidth = materialSwitch.measuredWidth.coerceAtLeast(minWidth) + (ripplePadding * 2)
    val childHeight = materialSwitch.measuredHeight.coerceAtLeast(minHeight) + (ripplePadding * 2)
    
    // Resolve the final dimensions. We use a custom resolution to avoid stretching 
    // when measured with EXACTLY large values unless they are small enough.
    val widthMode = MeasureSpec.getMode(widthMeasureSpec)
    val widthSize = MeasureSpec.getSize(widthMeasureSpec)
    val heightMode = MeasureSpec.getMode(heightMeasureSpec)
    val heightSize = MeasureSpec.getSize(heightMeasureSpec)

    val width = when (widthMode) {
      MeasureSpec.EXACTLY -> widthSize
      MeasureSpec.AT_MOST -> childWidth.coerceAtMost(widthSize)
      else -> childWidth
    }
    
    val height = when (heightMode) {
      MeasureSpec.EXACTLY -> heightSize
      MeasureSpec.AT_MOST -> childHeight.coerceAtMost(heightSize)
      else -> childHeight
    }
    
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

  fun setTrackColor(colorData: String?) {
    if (colorData == null) {
      customTrackColorOn = null
      customTrackColorOff = null
    } else {
      try {
        val obj = JSONObject(colorData)
        customTrackColorOn = obj.optString("true").takeIf { it.isNotEmpty() }?.let { parseColor(it) }
        customTrackColorOff = obj.optString("false").takeIf { it.isNotEmpty() }?.let { parseColor(it) }
      } catch (e: Exception) {
        // Fallback to single color
        customTrackColorOn = parseColor(colorData)
        customTrackColorOff = null
      }
    }
    updateColors()
  }

  fun setThumbColor(colorData: String?) {
    if (colorData == null) {
      customThumbColorOn = null
      customThumbColorOff = null
    } else {
      try {
        val obj = JSONObject(colorData)
        customThumbColorOn = obj.optString("true").takeIf { it.isNotEmpty() }?.let { parseColor(it) }
        customThumbColorOff = obj.optString("false").takeIf { it.isNotEmpty() }?.let { parseColor(it) }
      } catch (e: Exception) {
        // Fallback to single color
        customThumbColorOn = parseColor(colorData)
        customThumbColorOff = null
      }
    }
    updateColors()
  }

  private fun updateColors() {
    val states = arrayOf(
      intArrayOf(android.R.attr.state_checked),
      intArrayOf(-android.R.attr.state_checked)
    )

    if (customTrackColorOn != null || customTrackColorOff != null) {
      val onColor = customTrackColorOn ?: Color.TRANSPARENT
      val offColor = customTrackColorOff ?: Color.argb(60, Color.red(onColor), Color.green(onColor), Color.blue(onColor))
      
      val trackColors = intArrayOf(onColor, offColor)
      materialSwitch.trackTintList = ColorStateList(states, trackColors)
    } else {
      materialSwitch.trackTintList = null
    }

    if (customThumbColorOn != null || customThumbColorOff != null) {
      val onColor = customThumbColorOn ?: customThumbColorOff!!
      val offColor = customThumbColorOff ?: customThumbColorOn!!
      
      val thumbColors = intArrayOf(onColor, offColor)
      materialSwitch.thumbTintList = ColorStateList(states, thumbColors)
    } else {
      materialSwitch.thumbTintList = null
    }
  }

  private fun parseColor(colorStr: String): Int? {
    if (colorStr.isEmpty()) return null
    return try {
      when {
        colorStr.startsWith("#") -> Color.parseColor(colorStr)
        colorStr.startsWith("rgba(") -> parseRgba(colorStr)
        colorStr.startsWith("rgb(") -> parseRgb(colorStr)
        else -> {
          // Try as-is (for color names like "red", "white")
          try {
            Color.parseColor(colorStr)
          } catch (e: Exception) {
            // Try with # if it's a hex without it
            Color.parseColor("#$colorStr")
          }
        }
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
