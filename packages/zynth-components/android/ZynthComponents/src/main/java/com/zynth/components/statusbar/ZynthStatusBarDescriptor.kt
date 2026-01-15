package com.zynth.components.statusbar

import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

object ZynthStatusBarDescriptor {
  fun create(): ZynthComponentDescriptor {
    return ZynthComponentDescriptor(
      type = "zynth-status-bar",
      createView = { context, _ -> ZynthStatusBarView(context) },
      applyProperty = { node, name, value ->
        val view = node.view as? ZynthStatusBarView ?: return@ZynthComponentDescriptor false
        when (name) {
          "animated" -> {
            view.setAnimated(parseBoolean(value) ?: false)
            true
          }
          "hidden" -> {
            view.setHidden(parseBoolean(value) ?: false)
            true
          }
          "barStyle" -> {
            view.setBarStyle(parseString(value))
            true
          }
          "showHideTransition" -> {
            view.setShowHideTransition(parseString(value))
            true
          }
          "backgroundColor" -> {
            view.setBackgroundColorHex(parseString(value))
            true
          }
          else -> false
        }
      },
      onReset = { node ->
        (node.view as? ZynthStatusBarView)?.reset()
      },
    )
  }

  private fun parseBoolean(value: String?): Boolean? {
    val trimmed = value?.trim() ?: return null
    if (trimmed.isEmpty() || trimmed == "null") return null
    return try {
      val token = JSONTokener(trimmed).nextValue()
      when (token) {
        JSONObject.NULL -> null
        is Boolean -> token
        is String -> token.equals("true", ignoreCase = true)
        is Number -> token.toInt() != 0
        else -> null
      }
    } catch (_: JSONException) {
      when (trimmed.lowercase()) {
        "true" -> true
        "false" -> false
        else -> null
      }
    }
  }

  private fun parseString(value: String?): String? {
    val trimmed = value?.trim() ?: return null
    if (trimmed.isEmpty() || trimmed == "null") return null

    return try {
      val token = JSONTokener(trimmed).nextValue()
      when (token) {
        JSONObject.NULL -> null
        is String -> token
        is Boolean -> token.toString()
        is Number -> token.toString()
        else -> trimmed
      }
    } catch (_: JSONException) {
      trimmed.trim('"')
    }
  }
}

class ZynthStatusBarRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(ZynthStatusBarDescriptor.create())
  }
}
