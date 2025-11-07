package com.rune.components.statusbar

import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

object RuneStatusBarDescriptor {
  fun create(): RuneComponentDescriptor {
    return RuneComponentDescriptor(
      type = "rune-status-bar",
      createView = { context, _ -> RuneStatusBarView(context) },
      applyProperty = { node, name, value ->
        val view = node.view as? RuneStatusBarView ?: return@RuneComponentDescriptor false
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
        (node.view as? RuneStatusBarView)?.reset()
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

class RuneStatusBarRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(RuneStatusBarDescriptor.create())
  }
}
