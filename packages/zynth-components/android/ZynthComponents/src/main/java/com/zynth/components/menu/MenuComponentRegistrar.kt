package com.zynth.components.menu

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject

class MenuComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(createMenuViewDescriptor())
    registry.register(createMenuTriggerDescriptor())
    registry.register(createMenuItemDescriptor())
    Log.d("ZynthComponents", "Registered Menu component")
  }
}

private fun createMenuViewDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "menu-view",
    createView = { context: Context, _ ->
      ZynthMenuView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
      (node.view as? ZynthMenuView)?.let { menuView ->
        menuView.manager = manager
        menuView.nodeId = node.id
      }
      node.mountHasVisualProps = true
      node.mountAwaitingFirstProps = false
    },
    onSetHandler = { node, event ->
      val menuView = node.view as? ZynthMenuView ?: return@ZynthComponentDescriptor false
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
      (node.view as? ZynthMenuView)?.reset()
    },
  )
}

private fun createMenuTriggerDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "menu-trigger-view",
    createView = { context: Context, _ ->
      ZynthMenuTriggerView(context).apply {
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
      (node.view as? ZynthMenuTriggerView)?.reset()
    },
  )
}

private fun createMenuItemDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "menu-item-view",
    createView = { context: Context, _ ->
      ZynthMenuItemView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
      (node.view as? ZynthMenuItemView)?.let { itemView ->
        itemView.manager = manager
        itemView.nodeId = node.id
      }
    },
    applyProperty = { node, name, value ->
      val itemView = node.view as? ZynthMenuItemView ?: return@ZynthComponentDescriptor false
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
      val itemView = node.view as? ZynthMenuItemView ?: return@ZynthComponentDescriptor false
      if (event == "onPress") {
        itemView.hasOnPressHandler = true
        true
      } else {
        false
      }
    },
    onReset = { node ->
      (node.view as? ZynthMenuItemView)?.reset()
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
