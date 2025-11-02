package com.rune.components.pressable

import android.content.Context
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RunePressableEventListener
import com.rune.kit.core.RuneUIManager

class PressableComponentRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(
      RuneComponentDescriptor(
        type = "pressable",
        createView = { context: Context, _: Int ->
          RunePressableView(context).apply {
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.WRAP_CONTENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
            resetState()
          }
        },
        onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
          (node.view as? RunePressableView)?.let { pressable ->
            pressable.resetState()
            pressable.nodeId = node.id
            pressable.listener = manager
            pressable.setPointerEvents("auto")
            node.pointerEvents = "auto"
          }
        },
        applyProperty = { node, name, value -> PressablePropAdapter.apply(node, name, value) },
        onSetHandler = { node, event ->
          val pressable = node.view as? RunePressableView ?: return@RuneComponentDescriptor false
          if (event == "onLongPress") {
            pressable.setHasLongPressHandler(true)
            true
          } else {
            false
          }
        },
        onReset = { node ->
          (node.view as? RunePressableView)?.let {
            it.resetState()
            node.pointerEvents = "auto"
          }
        },
      ),
    )
  }
}
