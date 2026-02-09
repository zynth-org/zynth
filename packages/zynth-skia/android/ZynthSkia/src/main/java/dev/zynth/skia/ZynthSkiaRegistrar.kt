package dev.zynth.skia

import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

class ZynthSkiaRegistrar : ZynthComponentRegistrar {
    override fun register(registry: ZynthComponentRegistry) {
        registry.register(
            ZynthComponentDescriptor(
                type = "zynth-skia-view",
                createView = { context, _ -> ZynthSkiaView(context) },
                onNodeCreated = { manager, node ->
                    (node.view as? ZynthSkiaView)?.bind(manager, node.id)
                },
                applyProperty = { node, name, value ->
                    val view = node.view as? ZynthSkiaView ?: return@ZynthComponentDescriptor false
                    when (name) {
                        "clearColor" -> {
                            view.setClearColor(parseString(value))
                            true
                        }
                        "frameLoop" -> {
                            view.setFrameLoopEnabled(parseBoolean(value, false))
                            true
                        }
                        "allowFallback" -> {
                            view.setAllowFallback(parseBoolean(value, true))
                            true
                        }
                        "commands" -> {
                            val parsed = parseArray(value)
                            view.submitCommands(parsed ?: JSONArray())
                            true
                        }
                        "onNativeReady" -> true
                        else -> false
                    }
                },
                onSetHandler = { node, event ->
                    val view = node.view as? ZynthSkiaView ?: return@ZynthComponentDescriptor false
                    when (event) {
                        "onNativeReady" -> {
                            view.markSurfaceReady()
                            true
                        }
                        else -> false
                    }
                },
                onReset = { node ->
                    val view = node.view as? ZynthSkiaView ?: return@ZynthComponentDescriptor
                    view.resetSurface()
                    SkiaViewRegistry.unregister(node.id)
                },
            ),
        )
    }

    private fun parseBoolean(raw: String?, fallback: Boolean): Boolean {
        if (raw == null) return fallback
        return when (raw.trim().trim('"').lowercase()) {
            "true", "1" -> true
            "false", "0" -> false
            else -> fallback
        }
    }

    private fun parseString(raw: String?): String? {
        if (raw == null) return null
        val trimmed = raw.trim()
        if (trimmed == "null") return null
        return trimmed.trim('"')
    }

    private fun parseArray(raw: String?): JSONArray? {
        if (raw == null) return null
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || trimmed == "null") return null
        val parsed = runCatching { JSONTokener(trimmed).nextValue() }.getOrNull()
        return when (parsed) {
            is JSONArray -> parsed
            is JSONObject -> JSONArray().put(parsed)
            else -> null
        }
    }
}
