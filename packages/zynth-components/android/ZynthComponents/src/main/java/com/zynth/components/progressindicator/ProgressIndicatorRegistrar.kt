package com.zynth.components.progressindicator

import android.content.Context
import android.util.Log
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.layout.MeasureMode
import org.json.JSONObject
import kotlin.math.roundToInt

class ProgressIndicatorRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(
      ZynthComponentDescriptor(
        type = "progress-indicator",
        createView = { context: Context, nodeId: Int ->
          ZynthProgressIndicatorView(context).apply {
            this.nodeId = nodeId
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.WRAP_CONTENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
          }
        },
        onNodeCreated = { manager, node ->
          val indicator = node.view as? ZynthProgressIndicatorView ?: return@ZynthComponentDescriptor
          
          // Set up measurement handler for proper layout
          manager.getLayoutEngine().setMeasureHandler(node.id) { input ->
            val widthValue = when {
              input.width.isNaN() -> 0
              input.width.isInfinite() -> Int.MAX_VALUE / 2
              else -> input.width.roundToInt()
            }
            val heightValue = when {
              input.height.isNaN() -> 0
              input.height.isInfinite() -> Int.MAX_VALUE / 2
              else -> input.height.roundToInt()
            }
            
            val widthSpec = when (input.widthMode) {
              MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.EXACTLY)
              MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.AT_MOST)
              MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
            }
            val heightSpec = when (input.heightMode) {
              MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.EXACTLY)
              MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.AT_MOST)
              MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
            }
            
            indicator.measure(widthSpec, heightSpec)
            val measuredWidth = indicator.measuredWidth.coerceAtLeast(1)
            val measuredHeight = indicator.measuredHeight.coerceAtLeast(1)
            
            measuredWidth.toFloat() to measuredHeight.toFloat()
          }
        },
        applyProperty = { node, name, value ->
          (node.view as? ZynthProgressIndicatorView)?.let { indicator ->
            try {
              when (name) {
                "color" -> {
                  val color = parseStringValue(value, name)
                  Log.d("ProgressIndicator", "applyProperty color: raw=$value parsed=$color")
                  indicator.setColor(color)
                  true
                }
                "size" -> {
                  val size = parseStringValue(value, name) ?: "small"
                  Log.d("ProgressIndicator", "applyProperty size: raw=$value parsed=$size")
                  indicator.setSize(size)
                  true
                }
                "animating" -> {
                  val animating = parseBooleanValue(value, name, true)
                  Log.d("ProgressIndicator", "applyProperty animating: raw=$value parsed=$animating")
                  indicator.setAnimating(animating)
                  true
                }
                else -> false
              }
            } catch (e: Exception) {
              Log.e("ProgressIndicator", "Error applying property $name: ${e.message}")
              false
            }
          } ?: false
        },
      ),
    )
  }

  /**
   * Parses a string value from JSON. Handles multiple formats:
   * - Object format: {"propName": "value"}
   * - Raw JSON string: "value"  
   * - Plain string: value
   */
  private fun parseStringValue(json: String?, propName: String): String? {
    if (json == null || json == "null" || json.isEmpty()) return null
    
    Log.d("ProgressIndicator", "parseStringValue: raw='$json' propName='$propName'")
    
    // First try as JSON object: {"propName": "value"}
    try {
      val obj = JSONObject(json)
      if (obj.has(propName) && !obj.isNull(propName)) {
        val result = obj.getString(propName)
        Log.d("ProgressIndicator", "parseStringValue: parsed from object = '$result'")
        return result
      }
    } catch (e: Exception) {
      // Not a JSON object, continue to other formats
    }
    
    // Try parsing as raw JSON string: "value"
    try {
      val wrapped = JSONObject("{\"v\":$json}")
      val result = wrapped.getString("v")
      Log.d("ProgressIndicator", "parseStringValue: parsed from wrapped = '$result'")
      return result
    } catch (e: Exception) {
      // Not a JSON string, continue
    }
    
    // Last resort: use as-is, trimming quotes
    val result = json.trim().trim('"')
    Log.d("ProgressIndicator", "parseStringValue: using trimmed = '$result'")
    return result
  }

  /**
   * Parses a boolean value from JSON.
   */
  private fun parseBooleanValue(json: String?, propName: String, default: Boolean): Boolean {
    if (json == null || json == "null") return default
    
    // First try as JSON object
    try {
      val obj = JSONObject(json)
      if (obj.has(propName)) {
        return obj.getBoolean(propName)
      }
    } catch (e: Exception) {
      // Not a JSON object
    }
    
    // Try parsing as raw boolean
    return when (json.trim().lowercase()) {
      "true" -> true
      "false" -> false
      else -> default
    }
  }
}
