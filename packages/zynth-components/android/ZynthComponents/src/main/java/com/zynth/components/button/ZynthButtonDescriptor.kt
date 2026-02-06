package com.zynth.components.button

import android.content.Context
import android.graphics.Color
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject

class ZynthButtonRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(
      ZynthComponentDescriptor(
        type = "button",
        createView = { context: Context, nodeId: Int ->
          ZynthButtonView(context).apply {
            this.nodeId = nodeId
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.WRAP_CONTENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
          }
        },
        onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
          (node.view as? ZynthButtonView)?.let { button ->
            button.nodeId = node.id
            button.listener = object : ZynthButtonView.Listener {
              override fun onPressIn(nodeId: Int) {
                manager.dispatchEvent(nodeId, "onPressIn", JSONObject())
              }

              override fun onPressOut(nodeId: Int, cancelled: Boolean) {
                manager.dispatchEvent(nodeId, "onPressOut", JSONObject().put("cancelled", cancelled))
              }

              override fun onPress(nodeId: Int) {
                manager.dispatchEvent(nodeId, "onPress", JSONObject())
              }

              override fun onLongPress(nodeId: Int, durationMs: Long) {
                manager.dispatchEvent(nodeId, "onLongPress", JSONObject().put("durationMs", durationMs))
              }

              override fun onFocus(nodeId: Int) {
                manager.dispatchEvent(nodeId, "onFocus", JSONObject())
              }

              override fun onBlur(nodeId: Int) {
                manager.dispatchEvent(nodeId, "onBlur", JSONObject())
              }

              override fun onKeyEvent(nodeId: Int, phase: String, key: String?) {
                val payload = if (key != null && key.isNotEmpty()) {
                  JSONObject().put("key", key)
                } else {
                  JSONObject()
                }
                manager.dispatchEvent(nodeId, phase, payload)
              }
            }
          }
        },
        applyProperty = { node, name, value ->
          (node.view as? ZynthButtonView)?.let { button ->
            try {
              when (name) {
                "variant" -> {
                  val variant = parseStringValue(value, name) ?: "filled"
                  button.setVariant(variant)
                  true
                }
                "tone" -> {
                  val tone = parseStringValue(value, name) ?: "primary"
                  button.setTone(tone)
                  true
                }
                "size" -> {
                  val size = parseStringValue(value, name) ?: "medium"
                  button.setButtonSize(size)
                  true
                }
                "rounded" -> {
                  val rounded = parseStringValue(value, name) ?: "md"
                  button.setRounded(rounded)
                  true
                }
                "title" -> {
                  val title = parseStringValue(value, name)
                  button.setTitle(title)
                  true
                }
                "iconOnly" -> {
                  val iconOnly = parseBooleanValue(value, name, false)
                  button.setIconOnly(iconOnly)
                  true
                }
                "baseColor" -> {
                  val colorStr = parseStringValue(value, name)
                  val color = colorStr?.let { parseColor(it) }
                  button.setBaseColor(color)
                  true
                }
                "disabled" -> {
                  val disabled = parseBooleanValue(value, name, false)
                  button.setDisabled(disabled)
                  true
                }
                "loading" -> {
                  val loading = parseBooleanValue(value, name, false)
                  button.setLoading(loading)
                  true
                }
                "loadingAriaLabel" -> {
                  val label = parseStringValue(value, name)
                  button.setLoadingAriaLabel(label)
                  true
                }
                "loadingIndicator" -> {
                  // If value is boolean false, disable native spinner.
                  // If null or true (or custom view which we don't support as native prop yet), enable it.
                  val show = if (value != null) {
                    val obj = try { JSONObject(value) } catch (e: Exception) { null }
                    if (obj == null && (value == "false" || value == "0")) {
                      false
                    } else {
                      true // Default to true if it's an object or "true"
                    }
                  } else {
                    true
                  }
                  button.setShowLoadingSpinner(show)
                  true
                }
                "pressEffect" -> {
                  val effect = parseStringValue(value, name)
                  button.setPressEffect(effect)
                  true
                }
                "pressRetentionOffset" -> {
                  val offset = parseDoubleValue(value, name)?.takeIf { it >= 0 }
                  button.setPressRetentionOffset(offset)
                  true
                }
                "hitSlop" -> {
                  val hitSlop = parseHitSlopValue(value, name)
                  button.setHitSlop(hitSlop)
                  true
                }
                "minimumTouchSize" -> {
                  val size = parseObjectValue(value, name)
                  button.setMinimumTouchSize(size)
                  true
                }
                "preventFocusOnPress" -> {
                  val prevent = parseBooleanValue(value, name, false)
                  button.setPreventFocusOnPress(prevent)
                  true
                }
                "haptics" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  val mode = obj.optString(name)
                  button.setHapticsMode(mode)
                  true
                }
                "ready" -> {
                  val ready = parseBooleanValue(value, name, true)
                  button.setReady(ready)
                  true
                }
                "__buttonCommand" -> {
                  val command = if (value != null) JSONObject(value) else null
                  button.handleCommand(command)
                  true
                }
                else -> false
              }
            } catch (e: Exception) {
              false
            }
          } ?: false
        },
        onSetHandler = { node, event ->
          val button = node.view as? ZynthButtonView ?: return@ZynthComponentDescriptor false
          if (event == "onLongPress") {
            button.setHasLongPressHandler(true)
            true
          } else {
            false
          }
        },
        onReset = { node ->
          (node.view as? ZynthButtonView)?.let {
            it.reset()
          }
        },
      ),
    )
  }

  /**
   * Parses a string value from JSON. Handles both:
   * - Object format: {"propName": "value"}
   * - Raw string format: "value" or value
   */
  private fun parseStringValue(json: String?, propName: String): String? {
    if (json == null || json == "null") return null
    return try {
      // First try as JSON object: {"propName": "value"}
      val obj = JSONObject(json)
      if (obj.isNull(propName)) null else obj.optString(propName)
    } catch (e: Exception) {
      // Fall back to raw string parsing
      try {
        // Try wrapping in object to parse JSON string: "value"
        val wrapped = JSONObject("{\"v\":$json}")
        wrapped.getString("v")
      } catch (e2: Exception) {
        // Last resort: use as-is, trimming quotes
        json.trim('"')
      }
    }
  }

  private fun parseBooleanValue(json: String?, propName: String, defaultValue: Boolean): Boolean {
    if (json == null || json == "null") return defaultValue
    val trimmed = json.trim()
    when {
      trimmed.equals("true", ignoreCase = true) -> return true
      trimmed.equals("false", ignoreCase = true) -> return false
      trimmed == "1" -> return true
      trimmed == "0" -> return false
    }

    return try {
      val obj = JSONObject(trimmed)
      if (!obj.isNull(propName)) obj.optBoolean(propName, defaultValue) else defaultValue
    } catch (e: Exception) {
      defaultValue
    }
  }

  private fun parseDoubleValue(json: String?, propName: String): Double? {
    if (json == null || json == "null") return null
    val trimmed = json.trim()
    trimmed.toDoubleOrNull()?.let { return it }

    return try {
      val obj = JSONObject(trimmed)
      if (!obj.isNull(propName)) obj.optDouble(propName) else null
    } catch (e: Exception) {
      null
    }
  }

  private fun parseObjectValue(json: String?, propName: String): JSONObject? {
    if (json == null || json == "null") return null
    return try {
      val obj = JSONObject(json)
      obj.optJSONObject(propName) ?: obj
    } catch (e: Exception) {
      null
    }
  }

  private fun parseHitSlopValue(json: String?, propName: String): JSONObject? {
    val obj = parseObjectValue(json, propName)
    if (obj != null) return obj
    val uniform = parseDoubleValue(json, propName) ?: return null
    return JSONObject()
      .put("top", uniform)
      .put("left", uniform)
      .put("bottom", uniform)
      .put("right", uniform)
  }

  private fun parseColor(colorStr: String): Int? {
    return try {
      // Handle hex colors with alpha (#AARRGGBB or #RRGGBB)
      when {
        colorStr.startsWith("#") && colorStr.length == 9 -> {
          // #AARRGGBB format
          val alpha = colorStr.substring(1, 3).toInt(16)
          val red = colorStr.substring(3, 5).toInt(16)
          val green = colorStr.substring(5, 7).toInt(16)
          val blue = colorStr.substring(7, 9).toInt(16)
          Color.argb(alpha, red, green, blue)
        }
        else -> Color.parseColor(colorStr)
      }
    } catch (e: Exception) {
      null
    }
  }
}
