package com.rune.components.glass

import android.util.Log
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.components.view.RuneViewContainer

fun createGlassViewDescriptor(): RuneComponentDescriptor {
    return RuneComponentDescriptor(
        type = "glass-view",
        createView = { context, _ -> RuneGlassView(context) },
        onNodeCreated = { _, node ->
             // Default LayoutParams matching ViewComponent
             val view = node.view as? RuneGlassView ?: return@RuneComponentDescriptor
             view.layoutParams = android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
             )
        },
        applyProperty = { node, name, jsonValue ->
            val view = node.view as? RuneGlassView ?: return@RuneComponentDescriptor false
            when (name) {
                "interactive" -> {
                    // jsonValue is likely a string "true"/"false" or raw boolean string representation
                    view.setInteractive(jsonValue == "true")
                    true
                }
                "pointerEvents" -> {
                    val modeString = jsonValue?.trim('"') ?: "auto"
                    val mode = when (modeString.lowercase()) {
                      "none" -> RuneViewContainer.PointerEventsMode.NONE
                      "box-none" -> RuneViewContainer.PointerEventsMode.BOX_NONE
                      "box-only" -> RuneViewContainer.PointerEventsMode.BOX_ONLY
                      else -> RuneViewContainer.PointerEventsMode.AUTO
                    }
                    view.pointerMode = mode
                    true
                }
                else -> false
            }
        },
        onStyleApplied = { node, style ->
            val view = node.view as? RuneGlassView ?: return@RuneComponentDescriptor
            
            // Replicate ViewComponent behavior for overflow and border radius
            val overflow = style.overflow ?: "visible"
            val shouldClip = overflow.equals("hidden", ignoreCase = true) || overflow.equals("scroll", ignoreCase = true)
            view.setOverflowHidden(shouldClip)
            
            val borderRadius = style.borderRadius ?: 0f
            view.setClipRadius(borderRadius)
        },
        onReset = { node ->
             val view = node.view as? RuneGlassView ?: return@RuneComponentDescriptor
             view.setInteractive(true)
             view.pointerMode = RuneViewContainer.PointerEventsMode.AUTO
             view.setOverflowHidden(false)
             view.setClipRadius(0f)
        }
    )
}

class GlassComponentRegistrar : RuneComponentRegistrar {
    override fun register(registry: com.rune.kit.components.RuneComponentRegistry) {
        registry.register(createGlassViewDescriptor())
        Log.d("RuneComponents", "Registered GlassView component")
    }
}
