package com.zynth.components.alert

import com.zynth.kit.components.ZynthComponentDescriptor
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

object ZynthAlertDescriptor {
  fun create(): ZynthComponentDescriptor {
    return ZynthComponentDescriptor(
      type = "zynth-alert",
      createView = { context, nodeId -> 
        ZynthAlertLayout(context).apply { this.nodeId = nodeId }
      },
      onNodeCreated = { manager, node ->
        (node.view as? ZynthAlertLayout)?.let { layout ->
          layout.listener = object : ZynthAlertListener {
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
        val layout = node.view as? ZynthAlertLayout ?: return@ZynthComponentDescriptor false
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
        (node.view as? ZynthAlertLayout)?.reset()
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
