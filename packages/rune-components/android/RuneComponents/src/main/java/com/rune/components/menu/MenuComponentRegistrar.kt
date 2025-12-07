package com.rune.components.menu

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager
import org.json.JSONObject

class MenuComponentRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(createMenuViewDescriptor())
    registry.register(createMenuTriggerDescriptor())
    registry.register(createMenuItemDescriptor())
    Log.d("RuneComponents", "Registered Menu component")
  }
}

private fun createMenuViewDescriptor(): RuneComponentDescriptor {
  return RuneComponentDescriptor(
    type = "menu-view",
    createView = { context: Context, _ ->
      RuneMenuView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
      (node.view as? RuneMenuView)?.let { menuView ->
        menuView.manager = manager
        menuView.nodeId = node.id
      }
      node.mountHasVisualProps = true
      node.mountAwaitingFirstProps = false
    },
    onSetHandler = { node, event ->
      val menuView = node.view as? RuneMenuView ?: return@RuneComponentDescriptor false
      when (event) {
        "onOpen" -> {
          menuView.hasOnOpenHandler = true
          true
        }
        "onClose" -> {
          menuView.hasOnCloseHandler = true
          true
        }
        else -> false
      }
    },
    onReset = { node ->
      (node.view as? RuneMenuView)?.reset()
    },
  )
}

private fun createMenuTriggerDescriptor(): RuneComponentDescriptor {
  return RuneComponentDescriptor(
    type = "menu-trigger-view",
    createView = { context: Context, _ ->
      RuneMenuTriggerView(context).apply {
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
      (node.view as? RuneMenuTriggerView)?.reset()
    },
  )
}

private fun createMenuItemDescriptor(): RuneComponentDescriptor {
  return RuneComponentDescriptor(
    type = "menu-item-view",
    createView = { context: Context, _ ->
      RuneMenuItemView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
      (node.view as? RuneMenuItemView)?.let { itemView ->
        itemView.manager = manager
        itemView.nodeId = node.id
      }
    },
    applyProperty = { node, name, value ->
      val itemView = node.view as? RuneMenuItemView ?: return@RuneComponentDescriptor false
      when (name) {
        "label" -> {
          itemView.label = parseStringValue(value, name)
          true
        }
        "destructive" -> {
          itemView.destructive = parseBooleanValue(value, name, false)
          true
        }
        "disabled" -> {
          itemView.disabled = parseBooleanValue(value, name, false)
          true
        }
        else -> false
      }
    },
    onSetHandler = { node, event ->
      val itemView = node.view as? RuneMenuItemView ?: return@RuneComponentDescriptor false
      if (event == "onPress") {
        itemView.hasOnPressHandler = true
        true
      } else {
        false
      }
    },
    onReset = { node ->
      (node.view as? RuneMenuItemView)?.reset()
    },
  )
}

private fun parseStringValue(json: String?, propName: String): String? {
  if (json == null || json == "null") return null
  return try {
    val obj = JSONObject(json)
    if (obj.isNull(propName)) null else obj.optString(propName)
  } catch (e: Exception) {
    try {
      val wrapped = JSONObject("{\"v\":$json}")
      wrapped.getString("v")
    } catch (e2: Exception) {
      json.trim('"')
    }
  }
}

private fun parseBooleanValue(json: String?, propName: String, defaultValue: Boolean): Boolean {
  if (json == null || json == "null") return defaultValue
  return try {
    val obj = JSONObject(json)
    if (obj.isNull(propName)) defaultValue else obj.optBoolean(propName, defaultValue)
  } catch (e: Exception) {
    when (json.trim('"').lowercase()) {
      "true" -> true
      "false" -> false
      else -> defaultValue
    }
  }
}
