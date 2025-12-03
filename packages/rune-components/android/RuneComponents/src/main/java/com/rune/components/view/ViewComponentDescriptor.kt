package com.rune.components.view

import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar

/**
 * Creates and returns the View component descriptor.
 */
fun createViewComponentDescriptor(): RuneComponentDescriptor {
  return RuneComponentDescriptor(
    type = "view",
    createView = { context, _ -> RuneViewContainer(context) },
    onNodeCreated = { manager, node ->
      val viewContainer = node.view as? RuneViewContainer ?: return@RuneComponentDescriptor
      
      // Set appropriate layout params - WRAP_CONTENT allows Yoga to control sizing
      viewContainer.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
      viewContainer.manager = manager
      viewContainer.nodeId = node.id
      // No default width applied - views shrink to fit content (standard CSS Flexbox behavior)
      // Parent's alignItems and child's alignSelf control cross-axis alignment
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
      val viewContainer = node.view as? RuneViewContainer ?: return@RuneComponentDescriptor
      // CSS overflow behavior: only clip THIS container's content, not propagate to descendants
      val overflow = style.overflow ?: "visible"
      val shouldClip = overflow.equals("hidden", ignoreCase = true) || overflow.equals("scroll", ignoreCase = true)
      viewContainer.setOverflowHidden(shouldClip)
      
      // Set corner radius for rounded clipping if needed
      val borderRadius = style.borderRadius ?: 0f
      viewContainer.setClipRadius(borderRadius)
    },
    onSetHandler = { node, event ->
      val viewContainer = node.view as? RuneViewContainer ?: return@RuneComponentDescriptor false
      if (event == "onPress") {
        viewContainer.hasOnPressHandler = true
        viewContainer.setOnClickListener {
          if (!viewContainer.hasOnPressHandler) return@setOnClickListener
          val manager = viewContainer.manager ?: return@setOnClickListener
          val nodeId = viewContainer.nodeId
          if (nodeId >= 0) {
            manager.dispatchEvent(nodeId, "onPress", null)
          }
        }
        val mode = viewContainer.pointerMode
        viewContainer.isClickable =
          mode != RuneViewContainer.PointerEventsMode.NONE &&
          mode != RuneViewContainer.PointerEventsMode.BOX_NONE
        true
      } else {
        false
      }
    },
    onReset = { node ->
      val viewContainer = node.view as? RuneViewContainer ?: return@RuneComponentDescriptor
      viewContainer.pointerMode = RuneViewContainer.PointerEventsMode.AUTO
      viewContainer.setOverflowHidden(false)
      viewContainer.setClipRadius(0f)
      viewContainer.hasOnPressHandler = false
      viewContainer.setOnClickListener(null)
      viewContainer.isClickable = false
      viewContainer.manager = null
      viewContainer.nodeId = -1
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
