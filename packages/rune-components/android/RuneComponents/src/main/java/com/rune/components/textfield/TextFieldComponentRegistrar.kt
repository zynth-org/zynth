package com.rune.components.textfield

import android.content.Context
import android.util.Log
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.MeasureMode
import org.json.JSONObject
import kotlin.math.roundToInt

class TextFieldComponentRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(
      RuneComponentDescriptor(
        type = "text-field",
        createView = { context: Context, nodeId: Int ->
          RuneTextFieldView(context).apply {
            this.nodeId = nodeId
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
          }
        },
        onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
          val textFieldView = node.view as? RuneTextFieldView ?: return@RuneComponentDescriptor
          textFieldView.nodeId = node.id

          // Set up the event listeners
          textFieldView.listener = object : RuneTextFieldView.Listener {
            override fun onChange(nodeId: Int, value: String) {
              manager.dispatchEvent(nodeId, "onChange", JSONObject().put("value", value))
            }

            override fun onFocus(nodeId: Int) {
              manager.dispatchEvent(nodeId, "onFocus", JSONObject())
            }

            override fun onBlur(nodeId: Int) {
              manager.dispatchEvent(nodeId, "onBlur", JSONObject())
            }

            override fun onSubmit(nodeId: Int, value: String) {
              manager.dispatchEvent(nodeId, "onSubmit", JSONObject().put("value", value))
            }
          }

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

            textFieldView.measure(widthSpec, heightSpec)
            val measuredWidth = textFieldView.measuredWidth.coerceAtLeast(1)
            val measuredHeight = textFieldView.measuredHeight.coerceAtLeast(1)

            measuredWidth.toFloat() to measuredHeight.toFloat()
          }
        },
        applyProperty = { node, name, value ->
          (node.view as? RuneTextFieldView)?.let { textFieldView ->
            try {
              when (name) {
                "value" -> {
                  val strValue = parseStringValue(value, name) ?: ""
                  Log.d(TAG, "applyProperty value: raw=$value parsed=$strValue")
                  textFieldView.setValue(strValue)
                  true
                }
                "defaultValue" -> {
                  val strValue = parseStringValue(value, name) ?: ""
                  Log.d(TAG, "applyProperty defaultValue: raw=$value parsed=$strValue")
                  // Only set if text is empty (initial load)
                  textFieldView.setValue(strValue)
                  true
                }
                "placeholder" -> {
                  val strValue = parseStringValue(value, name) ?: ""
                  Log.d(TAG, "applyProperty placeholder: raw=$value parsed=$strValue")
                  textFieldView.setPlaceholder(strValue)
                  true
                }
                "disabled" -> {
                  val disabled = parseBooleanValue(value, name, false)
                  Log.d(TAG, "applyProperty disabled: raw=$value parsed=$disabled")
                  textFieldView.setDisabled(disabled)
                  true
                }
                "editable" -> {
                  val editable = parseBooleanValue(value, name, true)
                  Log.d(TAG, "applyProperty editable: raw=$value parsed=$editable")
                  textFieldView.setEditable(editable)
                  true
                }
                "secureTextEntry" -> {
                  val secure = parseBooleanValue(value, name, false)
                  Log.d(TAG, "applyProperty secureTextEntry: raw=$value parsed=$secure")
                  textFieldView.setSecureTextEntry(secure)
                  true
                }
                "keyboardType" -> {
                  val strValue = parseStringValue(value, name) ?: "default"
                  Log.d(TAG, "applyProperty keyboardType: raw=$value parsed=$strValue")
                  textFieldView.setKeyboardType(strValue)
                  true
                }
                "returnKeyType" -> {
                  val strValue = parseStringValue(value, name) ?: "done"
                  Log.d(TAG, "applyProperty returnKeyType: raw=$value parsed=$strValue")
                  textFieldView.setReturnKeyType(strValue)
                  true
                }
                "autoCapitalize" -> {
                  val strValue = parseStringValue(value, name) ?: "sentences"
                  Log.d(TAG, "applyProperty autoCapitalize: raw=$value parsed=$strValue")
                  textFieldView.setAutoCapitalize(strValue)
                  true
                }
                "autoCorrect" -> {
                  val autoCorrect = parseBooleanValue(value, name, true)
                  Log.d(TAG, "applyProperty autoCorrect: raw=$value parsed=$autoCorrect")
                  textFieldView.setAutoCorrect(autoCorrect)
                  true
                }
                "maxLength" -> {
                  val maxLen = parseIntValue(value, name, Int.MAX_VALUE)
                  Log.d(TAG, "applyProperty maxLength: raw=$value parsed=$maxLen")
                  textFieldView.setMaxLength(maxLen)
                  true
                }
                "requestFocus" -> {
                  val shouldFocus = parseBooleanValue(value, name, false)
                  Log.d(TAG, "applyProperty requestFocus: raw=$value parsed=$shouldFocus")
                  if (shouldFocus) {
                    textFieldView.requestFocusField()
                  }
                  true
                }
                "requestBlur" -> {
                  val shouldBlur = parseBooleanValue(value, name, false)
                  Log.d(TAG, "applyProperty requestBlur: raw=$value parsed=$shouldBlur")
                  if (shouldBlur) {
                    textFieldView.requestBlurField()
                  }
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
    private const val TAG = "TextFieldComponent"
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

  /**
   * Parses an integer value from JSON.
   */
  private fun parseIntValue(json: String?, propName: String, default: Int): Int {
    if (json == null || json == "null") return default

    // First try as JSON object
    try {
      val obj = JSONObject(json)
      if (obj.has(propName)) {
        return obj.getInt(propName)
      }
    } catch (e: Exception) {
      // Not a JSON object
    }

    // Try parsing as raw integer
    return try {
      json.trim().toInt()
    } catch (e: Exception) {
      default
    }
  }
}
