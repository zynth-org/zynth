package com.rune.components.image

import android.content.Context
import android.widget.FrameLayout
import android.widget.ImageView
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager

class ImageComponentRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    // Create a single shared instance for all nodes - this is lifecycle independent
    // since the component itself doesn't hold node-specific state (it's stored in node.imageState)
    var imageComponent: RuneImageComponent? = null

    registry.register(
      RuneComponentDescriptor(
        type = "image",
        createView = { context: Context, _: Int ->
          ImageView(context).apply {
            layoutParams = FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.WRAP_CONTENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
          }
        },
        onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
          // Lazy initialization of the component on first use
          if (imageComponent == null) {
            imageComponent = RuneImageComponent(
              root = manager.getRootView(),
              engine = manager.getLayoutEngine(),
              eventDispatcher = { nodeId, event -> manager.dispatchEvent(nodeId, event, null) },
              scheduleFlush = { manager.flush() },
              storeEventPayload = { nodeId, event, payload -> manager.dispatchEvent(nodeId, event, payload) },
            )
          }

          // Initialize node state
          imageComponent?.initializeNode(node)

          // Register measure handler
          manager.setMeasureHandler(node.id) { input ->
            imageComponent?.measure(node, input) ?: (1f to 1f)
          }
        },
        applyProperty = { node, name, value ->
          imageComponent?.handleProp(node, name, value) ?: false
        },
        onStyleApplied = { node, style ->
          imageComponent?.onStyleApplied(node, style)
        },
        onSetHandler = { node, event ->
          when (event) {
            "onLoad", "onError" -> {
              imageComponent?.onHandlerSet(node, event)
              true
            }
            else -> false
          }
        },
        onReset = { node ->
          imageComponent?.cleanup(node)
        },
      ),
    )
  }
}
