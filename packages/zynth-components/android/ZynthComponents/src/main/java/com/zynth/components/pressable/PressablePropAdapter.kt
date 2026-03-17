package com.zynth.components.pressable

import com.zynth.kit.core.ZynthUIManager
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

internal object PressablePropAdapter {
  fun apply(node: ZynthUIManager.Node, name: String, jsonValue: String?): Boolean {
    val pressable = node.view as? ZynthPressableView ?: return false
    val parsed = parseJsonValue(jsonValue)

    fun asBoolean(value: Any?): Boolean? = when (value) {
      is Boolean -> value
      is Number -> value.toInt() != 0
      is String -> value.equals("true", ignoreCase = true) || value == "1"
      else -> null
    }

    when (name) {
      "disabled" -> {
        val disabled = asBoolean(parsed) ?: false
        pressable.setDisabled(disabled)
        return true
      }
      "pressEffect" -> {
        val effect = (parsed as? String) ?: parseString(jsonValue)
        pressable.setPressEffect(effect)
        return true
      }
      "pressRetentionOffset" -> {
        val number = parsed as? Number
        pressable.setPressRetentionOffset(number)
        return true
      }
      "hitSlop" -> {
        val json = when (parsed) {
          is JSONObject -> parsed
          is Number -> {
            val inset = parsed.toDouble()
            JSONObject().apply {
              put("top", inset)
              put("left", inset)
              put("bottom", inset)
              put("right", inset)
            }
          }
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        pressable.setHitSlop(json)
        return true
      }
      "delayPressInMs" -> {
        val number = parsed as? Number
        pressable.setDelayPressIn(number)
        return true
      }
      "delayPressOutMs" -> {
        val number = parsed as? Number
        pressable.setDelayPressOut(number)
        return true
      }
      "delayLongPressMs", "longPressMinDurationMs" -> {
        val number = parsed as? Number
        pressable.setDelayLongPress(number)
        return true
      }
      "allowTouchPropagation" -> {
        val allow = asBoolean(parsed) ?: false
        pressable.setAllowTouchPropagation(allow)
        return true
      }
      "cancelOnOutside" -> {
        val cancel = asBoolean(parsed) ?: true
        pressable.setCancelOnOutside(cancel)
        return true
      }
      "enableDoublePress" -> {
        val enabled = asBoolean(parsed) ?: false
        pressable.setEnableDoublePress(enabled)
        return true
      }
      "doublePressWindowMs" -> {
        val number = parsed as? Number
        pressable.setDoublePressWindow(number)
        return true
      }
      "focusable" -> {
        val focusable = asBoolean(parsed) ?: true
        pressable.setFocusableSurface(focusable)
        return true
      }
      "preventFocusOnPress" -> {
        val prevent = asBoolean(parsed) ?: false
        pressable.setPreventFocusOnPress(prevent)
        return true
      }
      "pointerEvents" -> {
        val pointer = (parsed as? String) ?: parseString(jsonValue)
        pressable.setPointerEvents(pointer)
        node.pointerEvents = pointer ?: "auto"
        return true
      }
      "ready" -> {
        val ready = asBoolean(parsed) ?: true
        pressable.setReady(ready)
        return true
      }
      "activateKeys" -> {
        val keys: Set<String> = when (parsed) {
          is JSONArray -> {
            val result = mutableSetOf<String>()
            for (i in 0 until parsed.length()) {
              parsed.optString(i)?.let { result.add(it) }
            }
            result
          }
          is List<*> -> parsed.mapNotNull { it?.toString() }.toSet()
          else -> {
            jsonValue?.let {
              runCatching {
                val arr = JSONArray(it)
                val result = mutableSetOf<String>()
                for (i in 0 until arr.length()) {
                  arr.optString(i)?.let { key -> result.add(key) }
                }
                result
              }.getOrDefault(emptySet())
            } ?: emptySet()
          }
        }
        pressable.setActivateKeys(keys)
        return true
      }
      "__pressableCommand" -> {
        val json = when (parsed) {
          is JSONObject -> parsed
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        pressable.handleCommand(json)
        return true
      }
      "stateLayerStyle" -> {
        // Reserved for future styling enhancements
        return true
      }
      "borderRadius" -> {
        val number = parsed as? Number
        val r = number?.toFloat() ?: 0f
        pressable.setBorderRadii(r, r, r, r)
        return true
      }
    }

    return false
  }

  private fun parseString(raw: String?): String? {
    if (raw == null) return null
    return runCatching {
      val tokener = JSONTokener(raw)
      val value = tokener.nextValue()
      when (value) {
        JSONObject.NULL -> null
        is String -> value
        is Number, is Boolean -> value.toString()
        else -> raw
      }
    }.getOrDefault(raw)
  }

  private fun parseJsonValue(raw: String?): Any? {
    if (raw == null) return null
    return try {
      val value = JSONTokener(raw).nextValue()
      when (value) {
        JSONObject.NULL -> null
        else -> value
      }
    } catch (_: IllegalArgumentException) {
      raw
    } catch (_: Exception) {
      raw
    }
  }
}
