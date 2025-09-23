package com.rune.components.button

import android.content.Context
import android.graphics.Color
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager
import org.json.JSONObject

class RuneButtonRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(
      RuneComponentDescriptor(
        type = "button",
        createView = { context: Context, nodeId: Int ->
          RuneButtonView(context).apply {
            this.nodeId = nodeId
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.WRAP_CONTENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
          }
        },
        onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
          (node.view as? RuneButtonView)?.let { button ->
            button.nodeId = node.id
            button.listener = object : RuneButtonView.Listener {
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
          (node.view as? RuneButtonView)?.let { button ->
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
                  val iconOnly = if (value != null) JSONObject(value).optBoolean(name, false) else false
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
                  val disabled = if (value != null) JSONObject(value).optBoolean(name, false) else false
                  button.setDisabled(disabled)
                  true
                }
                "loading" -> {
                  val loading = if (value != null) JSONObject(value).optBoolean(name, false) else false
                  button.setLoading(loading)
                  true
                }
                "loadingAriaLabel" -> {
                  val label = parseStringValue(value, name)
                  button.setLoadingAriaLabel(label)
                  true
                }
                "pressEffect" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  val effect = obj.optString(name)
                  button.setPressEffect(effect)
                  true
                }
                "pressRetentionOffset" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  val offset = obj.optDouble(name, -1.0).takeIf { it >= 0 }
                  button.setPressRetentionOffset(offset?.let { it as Number })
                  true
                }
                "hitSlop" -> {
                  val hitSlop = if (value != null) JSONObject(value).optJSONObject(name) else null
                  button.setHitSlop(hitSlop)
                  true
                }
                "minimumTouchSize" -> {
                  val size = if (value != null) JSONObject(value).optJSONObject(name) else null
                  button.setMinimumTouchSize(size)
                  true
                }
                "preventFocusOnPress" -> {
                  val prevent = if (value != null) JSONObject(value).optBoolean(name, false) else false
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
                  val ready = if (value != null) JSONObject(value).optBoolean(name, true) else true
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
          val button = node.view as? RuneButtonView ?: return@RuneComponentDescriptor false
          if (event == "onLongPress") {
            button.setHasLongPressHandler(true)
            true
          } else {
            false
          }
        },
        onReset = { node ->
          (node.view as? RuneButtonView)?.let {
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
      if (obj.isNull(propName)) null else obj.optString(propName, null)
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
