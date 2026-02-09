package dev.zynth.skia

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

class SkiaModule : ZynthModule, ZynthSyncModule {
    override val name = "Skia"

    override val constants: Map<String, Any>?
        get() = mapOf(
            "version" to "0.1.0",
            "supportsFrameLoop" to true,
            "supportsCommands" to listOf("clear", "rect", "circle", "line"),
        )

    override fun initialize() {
        // no-op
    }

    override fun invalidate() {
        SkiaViewRegistry.clear()
    }

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return callSync(method, args) as? JSONObject
            ?: JSONObject().put("ok", true)
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return try {
            val payload = args.firstOrNull().toJSONObject()
            val nodeId = payload?.optInt("nodeId", -1) ?: -1
            val view = if (nodeId > 0) SkiaViewRegistry.get(nodeId) else null
            when (method) {
                "createSurface" -> {
                    view?.markSurfaceReady()
                    JSONObject().put("ok", true)
                }
                "disposeSurface" -> {
                    view?.resetSurface()
                    JSONObject().put("ok", true)
                }
                "submitDrawCommands" -> {
                    val commands = payload?.optJSONArray("commands")
                    view?.submitCommands(commands ?: JSONArray())
                    JSONObject().put("ok", true)
                }
                "submitFrame" -> {
                    val frame = payload?.optJSONObject("frame")
                    view?.submitFrame(frame)
                    JSONObject().put("ok", true)
                }
                "invalidateSurface" -> {
                    view?.invalidateSurface()
                    JSONObject().put("ok", true)
                }
                "setFrameLoopEnabled" -> {
                    val enabled = payload?.optBoolean("enabled", false) ?: false
                    view?.setFrameLoopEnabled(enabled)
                    JSONObject().put("ok", true)
                }
                else -> JSONObject().put("error", "unknown_method")
            }
        } catch (error: Throwable) {
            JSONObject().put("error", error.message ?: "unknown_error")
        }
    }

    private fun Any?.toJSONObject(): JSONObject? {
        return when (this) {
            null -> null
            is JSONObject -> this
            is Map<*, *> -> JSONObject(this)
            is String -> {
                val trimmed = this.trim()
                if (trimmed.isEmpty() || trimmed == "null") return null
                when (val parsed = JSONTokener(trimmed).nextValue()) {
                    is JSONObject -> parsed
                    else -> null
                }
            }
            else -> null
        }
    }
}
