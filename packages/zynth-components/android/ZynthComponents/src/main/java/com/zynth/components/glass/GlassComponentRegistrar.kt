package com.zynth.components.glass

import android.util.Log
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.components.view.ZynthViewContainer

fun createGlassViewDescriptor(): ZynthComponentDescriptor {
    return ZynthComponentDescriptor(
        type = "glass-view",
        createView = { context, _ -> ZynthGlassView(context) },
        onNodeCreated = { _, node ->
             // Default LayoutParams matching ViewComponent
             val view = node.view as? ZynthGlassView ?: return@ZynthComponentDescriptor
             view.layoutParams = android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
             )
        },
        applyProperty = { node, name, jsonValue ->
            val view = node.view as? ZynthGlassView ?: return@ZynthComponentDescriptor false
            when (name) {
                "interactive" -> {
                    // jsonValue is likely a string "true"/"false" or raw boolean string representation
                    view.setInteractive(jsonValue == "true")
                    true
                }
                "pointerEvents" -> {
                    val modeString = jsonValue?.trim('"') ?: "auto"
                    val mode = when (modeString.lowercase()) {
                      "none" -> ZynthViewContainer.PointerEventsMode.NONE
                      "box-none" -> ZynthViewContainer.PointerEventsMode.BOX_NONE
                      "box-only" -> ZynthViewContainer.PointerEventsMode.BOX_ONLY
                      else -> ZynthViewContainer.PointerEventsMode.AUTO
                    }
                    view.pointerMode = mode
                    true
                }
                else -> false
            }
        },
        onStyleApplied = { node, style ->
            val view = node.view as? ZynthGlassView ?: return@ZynthComponentDescriptor
            
            // Replicate ViewComponent behavior for overflow and border radius
            val overflow = style.overflow ?: "visible"
            val shouldClip = overflow.equals("hidden", ignoreCase = true) || overflow.equals("scroll", ignoreCase = true)
            view.setOverflowHidden(shouldClip)
            
            val borderRadius = style.borderRadius ?: 0f
            view.setBorderRadii(borderRadius, borderRadius, borderRadius, borderRadius)
        },
        onReset = { node ->
             val view = node.view as? ZynthGlassView ?: return@ZynthComponentDescriptor
             view.setInteractive(true)
             view.pointerMode = ZynthViewContainer.PointerEventsMode.AUTO
             view.setOverflowHidden(false)
             view.setBorderRadii(0f, 0f, 0f, 0f)
        }
    )
}

class GlassComponentRegistrar : ZynthComponentRegistrar {
    override fun register(registry: com.zynth.kit.components.ZynthComponentRegistry) {
        registry.register(createGlassViewDescriptor())
        Log.d("ZynthComponents", "Registered GlassView component")
    }
}
