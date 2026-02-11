package dev.zynth.skia

import android.graphics.Color
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry

class SkiaComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(
      ZynthComponentDescriptor(
        type = "zynth-skia-view",
        createView = { context, _ -> SkiaView(context) },
        onNodeCreated = { manager, node ->
          (node.view as? SkiaView)?.bind(manager, node.id)
        },
        applyProperty = { node, name, raw ->
          val view = node.view as? SkiaView ?: return@ZynthComponentDescriptor false
          when (name) {
            "clearColor" -> {
              view.setClearColor(parseColor(raw))
              true
            }
            "frameLoop" -> {
              view.setFrameLoopEnabled(parseBoolean(raw, false))
              true
            }
            "allowFallback" -> {
              view.setAllowFallback(parseBoolean(raw, true))
              true
            }
            "commands" -> true
            else -> false
          }
        },
        onSetHandler = { node, event ->
          val view = node.view as? SkiaView ?: return@ZynthComponentDescriptor false
          when (event) {
            "onNativeReady" -> {
              view.emitNativeReady()
              true
            }
            else -> false
          }
        },
        onReset = { node ->
          (node.view as? SkiaView)?.reset()
        },
      )
    )
  }

  private fun parseBoolean(raw: String?, fallback: Boolean): Boolean {
    if (raw == null) return fallback
    return when (raw.trim().trim('"').lowercase()) {
      "1", "true" -> true
      "0", "false" -> false
      else -> fallback
    }
  }

  private fun parseColor(raw: String?): Int {
    val value = raw?.trim()?.trim('"') ?: return Color.TRANSPARENT
    if (value.isEmpty() || value == "null") return Color.TRANSPARENT
    return runCatching { Color.parseColor(value) }.getOrDefault(Color.TRANSPARENT)
  }
}
