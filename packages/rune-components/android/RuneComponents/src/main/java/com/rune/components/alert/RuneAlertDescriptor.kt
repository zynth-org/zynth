package com.rune.components.alert

import com.rune.kit.components.RuneComponentDescriptor
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

object RuneAlertDescriptor {
  fun create(): RuneComponentDescriptor {
    return RuneComponentDescriptor(
      type = "rune-alert",
      createView = { context, nodeId -> 
        RuneAlertLayout(context).apply { this.nodeId = nodeId }
      },
      onNodeCreated = { manager, node ->
        (node.view as? RuneAlertLayout)?.let { layout ->
          layout.listener = object : RuneAlertListener {
            override fun onButtonPress(nodeId: Int, index: Int) {
              manager.dispatchEvent(nodeId, "onButtonPress", JSONObject().put("index", index))
            }
            
            override fun onDismiss(nodeId: Int) {
              manager.dispatchEvent(nodeId, "onDismiss", JSONObject())
            }
          }
        }
      },
      applyProperty = { node, name, value ->
        val layout = node.view as? RuneAlertLayout ?: return@RuneComponentDescriptor false
        when (name) {
          "title" -> {
            parseString(value)?.let { layout.setAlertTitle(it) }
            true
          }
          "message" -> {
            parseString(value)?.let { layout.setAlertMessage(it) }
            true
          }
          "buttons" -> {
            parseString(value)?.let { layout.setButtons(it) }
            true
          }
          "__command" -> {
            parseString(value)?.let { layout.handleCommand(it) }
            true
          }
          else -> false
        }
      },
      onSetHandler = { _, event ->
        event == "onButtonPress" || event == "onDismiss"
      },
      onReset = { node ->
        (node.view as? RuneAlertLayout)?.reset()
      },
    )
  }
  
  private fun parseString(value: String?): String? {
    val trimmed = value?.trim() ?: return null
    if (trimmed.isEmpty() || trimmed == "null") return null

    if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("\"")) {
      return trimmed
    }

    return try {
      val token = JSONTokener(trimmed).nextValue()
      when {
        token === JSONObject.NULL -> null
        token is String -> token
        else -> trimmed
      }
    } catch (_: JSONException) {
      trimmed.trim('"')
    }
  }
}
