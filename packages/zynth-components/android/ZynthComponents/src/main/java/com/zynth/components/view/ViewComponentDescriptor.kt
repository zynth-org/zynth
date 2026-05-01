package com.zynth.components.view

import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.core.ZynthBorderDrawable

/**
 * Creates and returns the View component descriptor.
 */
fun createViewComponentDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "view",
    createView = { context, _ -> ZynthViewContainer(context) },
    onNodeCreated = { manager, node ->
      val viewContainer = node.view as? ZynthViewContainer ?: return@ZynthComponentDescriptor
      
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
      val viewContainer = node.view as? ZynthViewContainer
      if (viewContainer == null) {
        false
      } else {
        when (name) {
          "pointerEvents" -> {
            val modeString = jsonValue?.trim('"') ?: "auto"
            val mode = when (modeString.lowercase()) {
              "none" -> ZynthViewContainer.PointerEventsMode.NONE
              "box-none" -> ZynthViewContainer.PointerEventsMode.BOX_NONE
              "box-only" -> ZynthViewContainer.PointerEventsMode.BOX_ONLY
              else -> ZynthViewContainer.PointerEventsMode.AUTO
            }
            viewContainer.pointerMode = mode
            true
          }
          else -> false
        }
      }
    },
    onSetHandler = { node, event ->
      val viewContainer = node.view as? ZynthViewContainer ?: return@ZynthComponentDescriptor false
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
          mode != ZynthViewContainer.PointerEventsMode.NONE &&
          mode != ZynthViewContainer.PointerEventsMode.BOX_NONE
        true
      } else {
        false
      }
    },
    onReset = { node ->
      val viewContainer = node.view as? ZynthViewContainer ?: return@ZynthComponentDescriptor
      viewContainer.pointerMode = ZynthViewContainer.PointerEventsMode.AUTO
      viewContainer.setOverflowHidden(false)
      viewContainer.setBorderRadii(0f, 0f, 0f, 0f)
      viewContainer.hasOnPressHandler = false
      viewContainer.setOnClickListener(null)
      viewContainer.isClickable = false
      viewContainer.manager = null
      viewContainer.nodeId = -1
    }
  )
}

/**
 * Registrar that registers the View component with the ZynthComponentRegistry.
 * Automatically discovered via ServiceLoader.
 */
class ViewComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: com.zynth.kit.components.ZynthComponentRegistry) {
    val descriptor = createViewComponentDescriptor()
    registry.register(descriptor)
    Log.d("ZynthComponents", "Registered View component")
  }
}
