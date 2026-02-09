package dev.zynth.skia

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

internal object ZynthSkiaJSI {
    init {
        nativeInstall(ZynthSkiaJSI::class.java)
    }

    @JvmStatic
    fun createSurface(nodeId: Int): Boolean {
        val view = SkiaViewRegistry.get(nodeId) ?: return false
        view.markSurfaceReady()
        return true
    }

    @JvmStatic
    fun disposeSurface(nodeId: Int): Boolean {
        val view = SkiaViewRegistry.get(nodeId) ?: return false
        view.resetSurface()
        return true
    }

    @JvmStatic
    fun submitDrawCommands(nodeId: Int, commandsJson: String): Boolean {
        val view = SkiaViewRegistry.get(nodeId) ?: return false
        val commands = parseJSONArray(commandsJson) ?: JSONArray()
        view.submitCommands(commands)
        return true
    }

    @JvmStatic
    fun submitDrawCommandsPacked(
        nodeId: Int,
        opsBuffer: ByteBuffer,
        opCount: Int,
        stringTable: Array<String?>,
    ): Boolean {
        val view = SkiaViewRegistry.get(nodeId) ?: return false
        if (opCount <= 0) {
            view.submitPackedCommands(DoubleArray(0), stringTable)
            return true
        }
        val ordered = opsBuffer.order(ByteOrder.nativeOrder())
        val ops = DoubleArray(opCount)
        for (index in 0 until opCount) {
            ops[index] = ordered.getDouble(index * 8)
        }
        view.submitPackedCommands(ops, stringTable)
        return true
    }

    @JvmStatic
    fun submitFrame(nodeId: Int, frameJson: String): Boolean {
        val view = SkiaViewRegistry.get(nodeId) ?: return false
        val frame = parseJSONObject(frameJson)
        view.submitFrame(frame)
        return true
    }

    @JvmStatic
    fun invalidateSurface(nodeId: Int): Boolean {
        val view = SkiaViewRegistry.get(nodeId) ?: return false
        view.invalidateSurface()
        return true
    }

    @JvmStatic
    fun setFrameLoopEnabled(nodeId: Int, enabled: Boolean): Boolean {
        val view = SkiaViewRegistry.get(nodeId) ?: return false
        view.setFrameLoopEnabled(enabled)
        return true
    }

    private fun parseJSONObject(raw: String?): JSONObject? {
        if (raw == null) return null
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || trimmed == "null") return null
        return try {
            when (val parsed = JSONTokener(trimmed).nextValue()) {
                is JSONObject -> parsed
                else -> null
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun parseJSONArray(raw: String?): JSONArray? {
        if (raw == null) return null
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || trimmed == "null") return null
        return try {
            when (val parsed = JSONTokener(trimmed).nextValue()) {
                is JSONArray -> parsed
                is JSONObject -> JSONArray().put(parsed)
                else -> null
            }
        } catch (_: Throwable) {
            null
        }
    }

    @JvmStatic
    private external fun nativeInstall(clazz: Class<*>)
}
