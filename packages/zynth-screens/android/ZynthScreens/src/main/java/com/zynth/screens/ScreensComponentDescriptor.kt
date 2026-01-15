package com.zynth.screens

import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager

/**
 * Creates the ScreenContainer component descriptor.
 */
fun createScreenContainerDescriptor(): ZynthComponentDescriptor {
    return ZynthComponentDescriptor(
        type = "zynth-screen-container",
        createView = { context, _ -> ScreenContainerView(context) },
        onNodeCreated = { _, node ->
            node.view.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        },
        applyProperty = { _, _, _ ->
            // ScreenContainer doesn't have custom props currently
            false
        },
        onStyleApplied = { _, _ ->
            // Style is applied by the core system
        },
        onSetHandler = { _, _ ->
            false
        },
        onReset = { _ ->
            // Nothing to reset
        }
    )
}

/**
 * Creates the Screen component descriptor.
 */
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
                    val active = jsonValue?.trim('"')?.toBooleanStrictOrNull() 
                        ?: (jsonValue == "true")
                    screen.setActive(active)
                    true
                }
                "animation" -> {
                    val animType = jsonValue?.trim('"')
                    screen.setAnimationType(animType)
                    true
                }
                "gestureEnabled" -> {
                    val enabled = jsonValue?.trim('"')?.toBooleanStrictOrNull() 
                        ?: (jsonValue != "false")
                    screen.setGestureEnabled(enabled)
                    true
                }
                else -> false
            }
        },
        onStyleApplied = { _, _ ->
            // Style is applied by the core system
        },
        onSetHandler = { node, event ->
            if (node.view !is ScreenView) return@ZynthComponentDescriptor false
            
            when (event) {
                "onWillAppear" -> {
                    // Handler ID is managed by core, we just note that it's registered
                    true
                }
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
        }
    )
}

/**
 * Creates the ScreenTabsContainer component descriptor.
 */
fun createScreenTabsContainerDescriptor(): ZynthComponentDescriptor {
    return ZynthComponentDescriptor(
        type = "zynth-screen-tabs-container",
        createView = { context, _ -> ScreenTabsContainerView(context) },
        onNodeCreated = @Suppress("UNUSED_PARAMETER") { manager, node ->
            node.view.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            val container = node.view as? ScreenTabsContainerView
            container?.setUIManager(manager)
            container?.setNodeId(node.id)
        },
        applyProperty = { node, name, jsonValue ->
            val container = node.view as? ScreenTabsContainerView 
                ?: return@ZynthComponentDescriptor false
            
            when (name) {
                "selectedIndex" -> {
                    val index = jsonValue?.trim('"')?.toIntOrNull() ?: 0
                    container.setSelectedIndex(index)
                    true
                }
                "tabAnimation" -> {
                    val animType = jsonValue?.trim('"')
                    container.setTabAnimationType(animType)
                    true
                }
                "nativeTabBarEnabled" -> {
                    val enabled = jsonValue?.trim('"')?.toBooleanStrictOrNull() 
                        ?: (jsonValue == "true")
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
        onStyleApplied = { _, _ ->
            // Style is applied by the core system
        },
        onSetHandler = { node, event ->
            if (node.view !is ScreenTabsContainerView) return@ZynthComponentDescriptor false

            Log.d("ScreenTabsContainer", "onSetHandler: $event")

            // Return false to let the core ZynthPropApplier register the handler in ZynthEventManager.
            // Returning true implies we handled it (e.g. set a specific listener) and core might skip registration
            // depending on implementation details we can't see.
            false
        },
        onReset = { node ->
            val container = node.view as? ScreenTabsContainerView 
                ?: return@ZynthComponentDescriptor
            container.setSelectedIndex(0)
            container.setTabAnimationType("none")
            container.setNativeTabBarEnabled(false)
        }
    )
}

/**
 * Registrar that registers all screen components.
 * Discovered via ServiceLoader.
 */
class ScreensComponentRegistrar : ZynthComponentRegistrar {
    override fun register(registry: ZynthComponentRegistry) {
        registry.register(createScreenContainerDescriptor())
        registry.register(createScreenDescriptor())
        registry.register(createScreenTabsContainerDescriptor())
        Log.d("ZynthScreens", "Registered Screen components")
    }
}
