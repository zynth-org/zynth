package com.zynth.screens

import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry

fun createScreenContainerDescriptor(typeName: String): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = typeName,
    createView = { context, _ -> ScreenContainerView(context) },
    onNodeCreated = { _, node ->
      node.view.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
    },
    applyProperty = { _, _, _ ->
      false
    },
    onStyleApplied = { _, _ -> },
    onSetHandler = { node, event ->
      val container = node.view as? ScreenTabsContainerView ?: return@ZynthComponentDescriptor false
      when (event) {
        "onNativeTabSelect" -> true
        "onNativeTabMount" -> {
          container.replaySurfaceIconMounts()
          true
        }
        "onNativeTabUpdate" -> {
          container.replaySurfaceIconMounts()
          true
        }
        else -> false
      }
    },
    onReset = { _ -> },
  )
}

fun createScreenDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "zynth-screen",
    createView = { context, _ -> ScreenView(context) },
    onNodeCreated = { _, node ->
      node.view.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
    },
    applyProperty = { node, name, jsonValue ->
      val screen = node.view as? ScreenView ?: return@ZynthComponentDescriptor false
      when (name) {
        "screenKey" -> {
          val key = jsonValue?.trim('"') ?: ""
          screen.setScreenKey(key)
          true
        }
        "active" -> {
          val active = jsonValue?.trim('"')?.toBooleanStrictOrNull() ?: (jsonValue == "true")
          screen.setActive(active)
          true
        }
        "animation" -> {
          val animType = jsonValue?.trim('"')
          screen.setAnimationType(animType)
          true
        }
        "gestureEnabled" -> {
          val enabled = jsonValue?.trim('"')?.toBooleanStrictOrNull() ?: (jsonValue != "false")
          screen.setGestureEnabled(enabled)
          true
        }
        else -> false
      }
    },
    onStyleApplied = { _, _ -> },
    onSetHandler = { node, event ->
      if (node.view !is ScreenView) return@ZynthComponentDescriptor false
      when (event) {
        "onWillAppear" -> true
        "onDidAppear" -> true
        "onWillDisappear" -> true
        "onDidDisappear" -> true
        else -> false
      }
    },
    onReset = { node ->
      val screen = node.view as? ScreenView ?: return@ZynthComponentDescriptor
      screen.setActive(false)
      screen.setAnimationType("push")
      screen.setGestureEnabled(true)
    },
  )
}

fun createScreenTabsContainerDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "zynth-screen-tabs-container",
    createView = { context, _ -> ScreenTabsContainerView(context) },
    onNodeCreated = { manager, node ->
      node.view.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
      val container = node.view as? ScreenTabsContainerView
      container?.setUIManager(manager)
      container?.setNodeId(node.id)
    },
    applyProperty = { node, name, jsonValue ->
      val container = node.view as? ScreenTabsContainerView ?: return@ZynthComponentDescriptor false
      when (name) {
        "selectedIndex" -> {
          val index = jsonValue
            ?.trim('"')
            ?.toDoubleOrNull()
            ?.toInt()
            ?: 0
          container.setSelectedIndex(index)
          true
        }
        "tabAnimation" -> {
          val animType = jsonValue?.trim('"')
          container.setTabAnimationType(animType)
          true
        }
        "nativeTabBarEnabled" -> {
          val enabled = jsonValue?.trim('"')?.toBooleanStrictOrNull() ?: (jsonValue == "true")
          container.setNativeTabBarEnabled(enabled)
          true
        }
        "tabBarItems" -> {
          if (jsonValue != null) {
            container.setTabBarItems(jsonValue)
          }
          true
        }
        "tabBarOptions" -> {
          if (jsonValue != null) {
            container.setTabBarOptions(jsonValue)
          }
          true
        }
        else -> false
      }
    },
    onStyleApplied = { _, _ -> },
    onChildInserted = { _, parent, child, index ->
      val container = parent.view as? ScreenTabsContainerView ?: return@ZynthComponentDescriptor
      container.trackInsertIndex(child.view, index)
    },
    onSetHandler = { _, _ -> false },
    onReset = { node ->
      val container = node.view as? ScreenTabsContainerView ?: return@ZynthComponentDescriptor
      container.setSelectedIndex(0)
      container.setTabAnimationType("none")
      container.setNativeTabBarEnabled(false)
      container.setTabBarItems("[]")
    },
  )
}

class ScreensComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(createScreenContainerDescriptor("zynth-screen-container"))
    registry.register(createScreenContainerDescriptor("zynth-screen-sheet-container"))
    registry.register(createScreenDescriptor())
    registry.register(createScreenTabsContainerDescriptor())
    Log.d("ZynthScreens", "Registered screen components")
  }
}
