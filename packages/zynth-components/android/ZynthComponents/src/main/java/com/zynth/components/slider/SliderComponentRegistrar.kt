package com.zynth.components.slider

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

class SliderComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(
      ZynthComponentDescriptor(
        type = "slider-view",
        hasMeasureFunc = true,
        createView = { context: Context, nodeId: Int ->
          ZynthSliderView(context).apply {
            this.nodeId = nodeId
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
          }
        },
        onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
          val sliderView = node.view as? ZynthSliderView ?: return@ZynthComponentDescriptor
          sliderView.nodeId = node.id

          sliderView.listener = object : ZynthSliderView.Listener {
            override fun onValueChange(nodeId: Int, value: Float, isFinal: Boolean) {
              manager.dispatchEvent(
                nodeId,
                "onValueChange",
                JSONObject().put("value", value.toDouble()),
              )
              if (isFinal) {
                manager.dispatchEvent(
                  nodeId,
                  "onSlidingComplete",
                  JSONObject().put("value", value.toDouble()),
                )
              }
            }

            override fun onSlidingComplete(nodeId: Int, value: Float) {
              manager.dispatchEvent(
                nodeId,
                "onSlidingComplete",
                JSONObject().put("value", value.toDouble()),
              )
            }
          }

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

            sliderView.measure(widthSpec, heightSpec)
            val measuredWidth = sliderView.measuredWidth.coerceAtLeast(1)
            val measuredHeight = sliderView.measuredHeight.coerceAtLeast(1)

            measuredWidth.toFloat() to measuredHeight.toFloat()
          }
        },
        applyProperty = { node, name, value ->
          (node.view as? ZynthSliderView)?.let { sliderView ->
            try {
              when (name) {
                "value" -> {
                  val floatValue = parseFloatValue(value, name, sliderView.currentValue())
                  Log.d(TAG, "applyProperty value: raw=$value parsed=$floatValue")
                  sliderView.setValue(floatValue)
                  true
                }
                "minimumValue", "min" -> {
                  val minValue = parseFloatValue(value, name, 0f)
                  val maxValue = sliderView.maxValue()
                  sliderView.setRange(minValue, maxValue)
                  true
                }
                "maximumValue", "max" -> {
                  val maxValue = parseFloatValue(value, name, 1f)
                  val minValue = sliderView.minValue()
                  sliderView.setRange(minValue, maxValue)
                  true
                }
                "step" -> {
                  val stepValue = parseFloatValue(value, name, 0f)
                  Log.d(TAG, "applyProperty step: raw=$value parsed=$stepValue")
                  sliderView.setStep(stepValue.takeIf { it > 0f })
                  true
                }
                "disabled" -> {
                  val disabled = parseBooleanValue(value, name, false)
                  Log.d(TAG, "applyProperty disabled: raw=$value parsed=$disabled")
                  sliderView.setDisabled(disabled)
                  true
                }
                "minimumTrackTintColor" -> {
                  val color = parseStringValue(value, name)
                  Log.d(TAG, "applyProperty minimumTrackTintColor: raw=$value parsed=$color")
                  sliderView.setMinimumTrackColor(color)
                  true
                }
                "maximumTrackTintColor" -> {
                  val color = parseStringValue(value, name)
                  Log.d(TAG, "applyProperty maximumTrackTintColor: raw=$value parsed=$color")
                  sliderView.setMaximumTrackColor(color)
                  true
                }
                "thumbTintColor" -> {
                  val color = parseStringValue(value, name)
                  Log.d(TAG, "applyProperty thumbTintColor: raw=$value parsed=$color")
                  sliderView.setThumbTintColor(color)
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
    private const val TAG = "SliderComponent"
  }

  private fun parseStringValue(json: String?, propName: String): String? {
    if (json == null || json == "null" || json.isEmpty()) return null

    try {
      val obj = JSONObject(json)
      if (obj.has(propName) && !obj.isNull(propName)) {
        return obj.getString(propName)
      }
    } catch (_: Exception) {
    }

    try {
      val wrapped = JSONObject("{\"v\":$json}")
      return wrapped.getString("v")
    } catch (_: Exception) {
    }

    return json.trim().trim('"')
  }

  private fun parseBooleanValue(json: String?, propName: String, default: Boolean): Boolean {
    if (json == null || json == "null") return default

    try {
      val obj = JSONObject(json)
      if (obj.has(propName)) {
        return obj.getBoolean(propName)
      }
    } catch (_: Exception) {
    }

    return when (json.trim().lowercase()) {
      "true" -> true
      "false" -> false
      else -> default
    }
  }

  private fun parseFloatValue(json: String?, propName: String, default: Float): Float {
    if (json == null || json == "null") return default

    try {
      val obj = JSONObject(json)
      if (obj.has(propName)) {
        return obj.getDouble(propName).toFloat()
      }
    } catch (_: Exception) {
    }

    return json.toFloatOrNull() ?: default
  }
}
