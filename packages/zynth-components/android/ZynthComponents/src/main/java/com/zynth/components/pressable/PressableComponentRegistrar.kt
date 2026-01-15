package com.zynth.components.pressable

import android.content.Context
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthPressableEventListener
import com.zynth.kit.core.ZynthUIManager

class PressableComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(
      ZynthComponentDescriptor(
        type = "pressable",
        createView = { context: Context, _: Int ->
          ZynthPressableView(context).apply {
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.WRAP_CONTENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
            resetState()
          }
        },
        onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
          (node.view as? ZynthPressableView)?.let { pressable ->
            pressable.resetState()
            pressable.nodeId = node.id
            pressable.listener = manager
            pressable.setPointerEvents("auto")
            node.pointerEvents = "auto"
          }
        },
        applyProperty = { node, name, value -> PressablePropAdapter.apply(node, name, value) },
        onSetHandler = { node, event ->
          val pressable = node.view as? ZynthPressableView ?: return@ZynthComponentDescriptor false
          if (event == "onLongPress") {
            pressable.setHasLongPressHandler(true)
            true
          } else {
            false
          }
        },
        onReset = { node ->
          (node.view as? ZynthPressableView)?.let {
            it.resetState()
            node.pointerEvents = "auto"
          }
        },
      ),
    )
  }
}
