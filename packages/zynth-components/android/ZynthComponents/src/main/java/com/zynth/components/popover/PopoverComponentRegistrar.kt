package com.zynth.components.popover

import android.content.Context
import android.graphics.Color
import android.util.Log
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

class PopoverComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(createPopoverViewDescriptor())
    registry.register(createPopoverTriggerDescriptor())
    registry.register(createPopoverContentDescriptor())
    Log.d("ZynthComponents", "Registered Popover component")
  }
}

private fun createPopoverViewDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "popover-view",
    createView = { context: Context, _ ->
      ZynthPopoverView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
      (node.view as? ZynthPopoverView)?.let { popoverView ->
        popoverView.manager = manager
        popoverView.nodeId = node.id
      }
      node.mountHasVisualProps = true
      node.mountAwaitingFirstProps = false
    },
    applyProperty = { node, name, value ->
      val popoverView = node.view as? ZynthPopoverView ?: return@ZynthComponentDescriptor false
      when (name) {
        "surfaceColor" -> {
          popoverView.setSurfaceColor(parseString(value)?.let { parseColor(it) })
          true
        }
        "cornerRadius" -> {
          popoverView.setCornerRadius(parseFloat(value))
          true
        }
        "elevation" -> {
          popoverView.setElevation(parseFloat(value))
          true
        }
        "dismissOnOutsidePress" -> {
          popoverView.setDismissOnOutsidePress(parseBoolean(value, true))
          true
        }
        "offsetX" -> {
          popoverView.setOffsetX(parseFloat(value))
          true
        }
        "offsetY" -> {
          popoverView.setOffsetY(parseFloat(value))
          true
        }
        "__command" -> {
          popoverView.handleCommand(parseString(value))
          true
        }
        else -> false
      }
    },
    onSetHandler = { node, event ->
      val popoverView = node.view as? ZynthPopoverView ?: return@ZynthComponentDescriptor false
      when (event) {
        "onOpen" -> {
          popoverView.hasOnOpenHandler = true
          true
        }
        "onClose" -> {
          popoverView.hasOnCloseHandler = true
          true
        }
        else -> false
      }
    },
    onReset = { node ->
      (node.view as? ZynthPopoverView)?.reset()
    },
  )
}

private fun createPopoverTriggerDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "popover-trigger-view",
    createView = { context: Context, _ ->
      ZynthPopoverTriggerView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { _, node ->
      node.mountHasVisualProps = true
      node.mountAwaitingFirstProps = false
    },
    onReset = { node ->
      (node.view as? ZynthPopoverTriggerView)?.reset()
    },
  )
}

private fun createPopoverContentDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "popover-content-view",
    createView = { context: Context, _ ->
      ZynthPopoverContentView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { _, node ->
      node.mountHasVisualProps = true
      node.mountAwaitingFirstProps = false
    },
    onReset = { node ->
      (node.view as? ZynthPopoverContentView)?.reset()
    },
  )
}

private fun parseString(value: String?): String? {
  val trimmed = value?.trim() ?: return null
  if (trimmed.isEmpty() || trimmed == "null") return null

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

private fun parseBoolean(value: String?, fallback: Boolean): Boolean {
  val trimmed = value?.trim() ?: return fallback
  if (trimmed.isEmpty() || trimmed == "null") return fallback
  return try {
    val token = JSONTokener(trimmed).nextValue()
    when (token) {
      is Boolean -> token
      is Number -> token.toInt() != 0
      is String -> token.equals("true", ignoreCase = true)
      else -> fallback
    }
  } catch (_: Exception) {
    when (trimmed.lowercase()) {
      "true" -> true
      "false" -> false
      else -> fallback
    }
  }
}

private fun parseFloat(value: String?): Float? {
  val trimmed = value?.trim() ?: return null
  if (trimmed.isEmpty() || trimmed == "null") return null
  return try {
    val token = JSONTokener(trimmed).nextValue()
    when (token) {
      is Number -> token.toFloat()
      is String -> token.toFloatOrNull()
      else -> null
    }
  } catch (_: Exception) {
    trimmed.toFloatOrNull()
  }
}

private fun parseColor(raw: String?): Int? {
  val value = raw?.trim()?.trim('"') ?: return null
  if (value.isEmpty() || value == "null") return null
  return try {
    when {
      value.equals("transparent", ignoreCase = true) -> Color.TRANSPARENT
      value.startsWith("#") -> Color.parseColor(value)
      else -> Color.parseColor("#$value")
    }
  } catch (_: IllegalArgumentException) {
    null
  }
}
