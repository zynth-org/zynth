package com.zynth.components.modal

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

class ModalComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(createModalDescriptor())
    Log.d("ZynthComponents", "Registered Modal component")
  }
}

private fun createModalDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "zynth-modal",
    createView = { context: Context, _ ->
      ZynthModalView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.MATCH_PARENT,
          FrameLayout.LayoutParams.MATCH_PARENT,
        )
      }
    },
    onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
      (node.view as? ZynthModalView)?.let { modalView ->
        modalView.manager = manager
        modalView.nodeId = node.id
      }
      node.mountHasVisualProps = true
      node.mountAwaitingFirstProps = false
    },
    applyProperty = { node, name, value ->
      val modalView = node.view as? ZynthModalView ?: return@ZynthComponentDescriptor false
      when (name) {
        "open" -> {
          val open = parseBoolean(value, false)
          modalView.setOpenState(open)
          true
        }
        "animation" -> {
          modalView.setAnimationStyle(parseString(value))
          true
        }
        "transparent" -> {
          val transparent = parseBoolean(value, false)
          modalView.setTransparent(transparent)
          true
        }
        "overlayColor" -> {
          parseString(value)?.let { modalView.setOverlayColor(parseColor(it)) }
          true
        }
        "overlayOpacity" -> {
          val opacity = parseFloat(value)
          modalView.setOverlayOpacity(opacity)
          true
        }
        "dismissOnOverlayPress" -> {
          val dismiss = parseBoolean(value, true)
          modalView.setDismissOnOverlayPress(dismiss)
          true
        }
        "__command" -> {
          modalView.handleCommand(parseString(value))
          true
        }
        else -> false
      }
    },
    onSetHandler = { _, event ->
      event == "onOpenChange" || event == "onRequestClose" || event == "onDismiss"
    },
    onReset = { node ->
      (node.view as? ZynthModalView)?.reset()
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
