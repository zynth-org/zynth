package com.zynth.components.switch

import android.content.Context
import android.util.Log
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.layout.MeasureMode
import org.json.JSONObject
import kotlin.math.roundToInt

class SwitchComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(
      ZynthComponentDescriptor(
        type = "switch-view",
        createView = { context: Context, nodeId: Int ->
          ZynthSwitchView(context).apply {
            this.nodeId = nodeId
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.WRAP_CONTENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
          }
        },
        onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
          val switchView = node.view as? ZynthSwitchView ?: return@ZynthComponentDescriptor
          switchView.nodeId = node.id
          
          // Set up the value change listener
          switchView.listener = object : ZynthSwitchView.Listener {
            override fun onValueChange(nodeId: Int, value: Boolean) {
              manager.dispatchEvent(nodeId, "onValueChange", JSONObject().put("value", value))
            }
          }
          
          // Set up measurement handler for proper layout
          manager.setMeasureHandler(node.id) { input ->
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
            
            switchView.measure(widthSpec, heightSpec)
            val measuredWidth = switchView.measuredWidth.coerceAtLeast(1)
            val measuredHeight = switchView.measuredHeight.coerceAtLeast(1)
            
            measuredWidth.toFloat() to measuredHeight.toFloat()
          }
        },
        applyProperty = { node, name, value ->
          (node.view as? ZynthSwitchView)?.let { switchView ->
            try {
              when (name) {
                "value" -> {
                  val boolValue = parseBooleanValue(value, name, false)
                  Log.d(TAG, "applyProperty value: raw=$value parsed=$boolValue")
                  switchView.setValue(boolValue)
                  true
                }
                "disabled" -> {
                  val disabled = parseBooleanValue(value, name, false)
                  Log.d(TAG, "applyProperty disabled: raw=$value parsed=$disabled")
                  switchView.setDisabled(disabled)
                  true
                }
                "trackColor" -> {
                  val color = parseStringValue(value, name)
                  Log.d(TAG, "applyProperty trackColor: raw=$value parsed=$color")
                  switchView.setTrackColor(color)
                  true
                }
                "thumbColor" -> {
                  val color = parseStringValue(value, name)
                  Log.d(TAG, "applyProperty thumbColor: raw=$value parsed=$color")
                  switchView.setThumbColor(color)
                  true
                }
                else -> false
              }
            } catch (e: Exception) {
              Log.e(TAG, "Error applying property $name: ${e.message}")
              false
            }
          } ?: false
        },
      ),
    )
  }

  companion object {
    private const val TAG = "SwitchComponent"
  }

  /**
   * Parses a string value from JSON. Handles multiple formats:
   * - Object format: {"propName": "value"}
   * - Raw JSON string: "value"  
   * - Plain string: value
   */
  private fun parseStringValue(json: String?, propName: String): String? {
    if (json == null || json == "null" || json.isEmpty()) return null
    
    Log.d(TAG, "parseStringValue: raw='$json' propName='$propName'")
    
    // First try as JSON object: {"propName": "value"}
    try {
      val obj = JSONObject(json)
      if (obj.has(propName) && !obj.isNull(propName)) {
        val result = obj.getString(propName)
        Log.d(TAG, "parseStringValue: parsed from object = '$result'")
        return result
      }
    } catch (e: Exception) {
      // Not a JSON object, continue to other formats
    }
    
    // Try parsing as raw JSON string: "value"
    try {
      val wrapped = JSONObject("{\"v\":$json}")
      val result = wrapped.getString("v")
      Log.d(TAG, "parseStringValue: parsed from wrapped = '$result'")
      return result
    } catch (e: Exception) {
      // Not a JSON string, continue
    }
    
    // Last resort: use as-is, trimming quotes
    val result = json.trim().trim('"')
    Log.d(TAG, "parseStringValue: using trimmed = '$result'")
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
