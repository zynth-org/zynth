package com.rune.components.view

import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.Style

/**
 * Creates and returns the View component descriptor.
 */
fun createViewComponentDescriptor(): RuneComponentDescriptor {
  return RuneComponentDescriptor(
    type = "view",
    createView = { context, _ -> RuneViewContainer(context) },
    onNodeCreated = { manager, node ->
      val viewContainer = node.view as? RuneViewContainer ?: return@RuneComponentDescriptor
      
      // Set appropriate layout params
      node.view.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
      
      // Apply default width: 100%
      try {
        manager.getLayoutEngine().setStyle(node.id, Style(widthPercent = 100f))
      } catch (_: Throwable) {
        // Defensive: style application should never crash creation
      }
    },
    applyProperty = { node, name, jsonValue ->
      val viewContainer = node.view as? RuneViewContainer
      if (viewContainer == null) {
        false
      } else {
        when (name) {
          "pointerEvents" -> {
            val modeString = jsonValue?.trim('"') ?: "auto"
            val mode = when (modeString.lowercase()) {
              "none" -> RuneViewContainer.PointerEventsMode.NONE
              "box-none" -> RuneViewContainer.PointerEventsMode.BOX_NONE
              "box-only" -> RuneViewContainer.PointerEventsMode.BOX_ONLY
              else -> RuneViewContainer.PointerEventsMode.AUTO
            }
            viewContainer.pointerMode = mode
            true
          }
          else -> false
        }
      }
    },
    onStyleApplied = { node, style ->
      // View doesn't need special style handling beyond core
    },
    onSetHandler = { node, event ->
      // View doesn't handle any specific events directly
      // Events are handled by the core system
      false
    },
    onReset = { node ->
      val viewContainer = node.view as? RuneViewContainer ?: return@RuneComponentDescriptor
      viewContainer.pointerMode = RuneViewContainer.PointerEventsMode.AUTO
    }
  )
}

/**
 * Registrar that registers the View component with the RuneComponentRegistry.
 * Automatically discovered via ServiceLoader.
 */
class ViewComponentRegistrar : RuneComponentRegistrar {
  override fun register(registry: com.rune.kit.components.RuneComponentRegistry) {
    val descriptor = createViewComponentDescriptor()
    registry.register(descriptor)
    Log.d("RuneComponents", "Registered View component")
  }
}
