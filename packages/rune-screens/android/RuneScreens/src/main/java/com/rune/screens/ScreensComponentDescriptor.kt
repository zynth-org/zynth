package com.rune.screens

import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager

/**
 * Creates the ScreenContainer component descriptor.
 */
fun createScreenContainerDescriptor(): RuneComponentDescriptor {
    return RuneComponentDescriptor(
        type = "rune-screen-container",
        createView = { context, _ -> ScreenContainerView(context) },
        onNodeCreated = { _, node ->
            node.view.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        },
        applyProperty = { node, name, jsonValue ->
            // ScreenContainer doesn't have custom props currently
            false
        },
        onStyleApplied = { node, style ->
            // Style is applied by the core system
        },
        onSetHandler = { node, event ->
            false
        },
        onReset = { node ->
            // Nothing to reset
        }
    )
}

/**
 * Creates the Screen component descriptor.
 */
fun createScreenDescriptor(): RuneComponentDescriptor {
    return RuneComponentDescriptor(
        type = "rune-screen",
        createView = { context, _ -> ScreenView(context) },
        onNodeCreated = { manager, node ->
            node.view.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        },
        applyProperty = { node, name, jsonValue ->
            val screen = node.view as? ScreenView ?: return@RuneComponentDescriptor false
            
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
        onStyleApplied = { node, style ->
            // Style is applied by the core system
        },
        onSetHandler = { node, event ->
            val screen = node.view as? ScreenView ?: return@RuneComponentDescriptor false
            
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
            val screen = node.view as? ScreenView ?: return@RuneComponentDescriptor
            screen.setActive(false)
            screen.setAnimationType("push")
            screen.setGestureEnabled(true)
        }
    )
}

/**
 * Creates the ScreenTabsContainer component descriptor.
 */
fun createScreenTabsContainerDescriptor(): RuneComponentDescriptor {
    return RuneComponentDescriptor(
        type = "rune-screen-tabs-container",
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
            val container = node.view as? ScreenTabsContainerView 
                ?: return@RuneComponentDescriptor false
            
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
        onStyleApplied = { node, style ->
            // Style is applied by the core system
        },
        onSetHandler = { node, event ->
            val container = node.view as? ScreenTabsContainerView 
                ?: return@RuneComponentDescriptor false
            
            Log.d("ScreenTabsContainer", "onSetHandler: $event")
            
            // Return false to let the core RunePropApplier register the handler in RuneEventManager.
            // Returning true implies we handled it (e.g. set a specific listener) and core might skip registration
            // depending on implementation details we can't see.
            false
        },
        onReset = { node ->
            val container = node.view as? ScreenTabsContainerView 
                ?: return@RuneComponentDescriptor
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
class ScreensComponentRegistrar : RuneComponentRegistrar {
    override fun register(registry: RuneComponentRegistry) {
        registry.register(createScreenContainerDescriptor())
        registry.register(createScreenDescriptor())
        registry.register(createScreenTabsContainerDescriptor())
        Log.d("RuneScreens", "Registered Screen components")
    }
}
