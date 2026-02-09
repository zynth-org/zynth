package dev.zynth.skia

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.Choreographer
import android.view.View
import com.zynth.kit.components.ZynthInspectableComponent
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

class ZynthSkiaView(context: Context) : View(context), ZynthInspectableComponent {
    private val renderPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var clearColor: Int = Color.TRANSPARENT
    private var commands: List<SkiaCommand> = emptyList()
    private var nodeId: Int = -1
    private var manager: ZynthUIManager? = null
    private var frameLoopEnabled = AtomicBoolean(false)
    private var framePosted = AtomicBoolean(false)
    private val density = context.resources.displayMetrics.density

    private val frameCallback = Choreographer.FrameCallback {
        framePosted.set(false)
        if (!frameLoopEnabled.get()) return@FrameCallback
        invalidate()
        scheduleFrame()
    }

    fun bind(manager: ZynthUIManager, nodeId: Int) {
        this.manager = manager
        this.nodeId = nodeId
        SkiaViewRegistry.register(nodeId, this)
    }

    fun markSurfaceReady() {
        emitNativeReady()
    }

    fun resetSurface() {
        frameLoopEnabled.set(false)
        removeFrameCallback()
        commands = emptyList()
        clearColor = Color.TRANSPARENT
        invalidate()
    }

    fun invalidateSurface() {
        invalidate()
    }

    fun setFrameLoopEnabled(enabled: Boolean) {
        frameLoopEnabled.set(enabled)
        if (enabled) {
            scheduleFrame()
        } else {
            removeFrameCallback()
        }
    }

    fun submitCommands(rawCommands: JSONArray) {
        commands = parseCommands(rawCommands)
        invalidate()
    }

    fun submitFrame(frame: JSONObject?) {
        if (frame == null) return
        val clear = frame.optString("clear", "")
        if (clear.isNotEmpty()) {
            clearColor = parseColor(clear, clearColor)
        }
        val nextCommands = frame.optJSONArray("commands") ?: JSONArray()
        commands = parseCommands(nextCommands)
        invalidate()
    }

    fun setClearColor(raw: String?) {
        clearColor = parseColor(raw, clearColor)
        invalidate()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        setFrameLoopEnabled(false)
        if (nodeId > 0) {
            SkiaViewRegistry.unregister(nodeId)
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(clearColor)

        for (command in commands) {
            when (command) {
                is SkiaCommand.Clear -> canvas.drawColor(command.color)
                is SkiaCommand.Rect -> {
                    renderPaint.reset()
                    renderPaint.isAntiAlias = true
                    renderPaint.color = command.color
                    renderPaint.style = command.style
                    renderPaint.strokeWidth = command.strokeWidth
                    canvas.drawRect(command.x, command.y, command.x + command.width, command.y + command.height, renderPaint)
                }
                is SkiaCommand.Circle -> {
                    renderPaint.reset()
                    renderPaint.isAntiAlias = true
                    renderPaint.color = command.color
                    renderPaint.style = command.style
                    renderPaint.strokeWidth = command.strokeWidth
                    canvas.drawCircle(command.cx, command.cy, command.r, renderPaint)
                }
                is SkiaCommand.Line -> {
                    renderPaint.reset()
                    renderPaint.isAntiAlias = true
                    renderPaint.color = command.color
                    renderPaint.style = Paint.Style.STROKE
                    renderPaint.strokeWidth = command.strokeWidth
                    canvas.drawLine(command.x1, command.y1, command.x2, command.y2, renderPaint)
                }
            }
        }
    }

    override fun inspectState(): Map<String, Any?> {
        return mapOf(
            "nodeId" to nodeId,
            "frameLoopEnabled" to frameLoopEnabled.get(),
            "commandCount" to commands.size,
        )
    }

    private fun emitNativeReady() {
        if (nodeId <= 0) return
        manager?.dispatchEvent(nodeId, "onNativeReady", JSONObject().put("available", true))
    }

    private fun scheduleFrame() {
        if (framePosted.getAndSet(true)) return
        Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    private fun removeFrameCallback() {
        if (!framePosted.getAndSet(false)) return
        Choreographer.getInstance().removeFrameCallback(frameCallback)
    }

    private fun parseCommands(rawCommands: JSONArray): List<SkiaCommand> {
        val parsed = ArrayList<SkiaCommand>(rawCommands.length())
        for (index in 0 until rawCommands.length()) {
            val item = rawCommands.optJSONObject(index) ?: continue
            val type = item.optString("type", "")
            when (type) {
                "clear" -> {
                    val color = parseColor(item.optString("color", ""), Color.TRANSPARENT)
                    parsed.add(SkiaCommand.Clear(color))
                }
                "rect" -> {
                    parsed.add(
                        SkiaCommand.Rect(
                            x = dpToPx(item.optDouble("x", 0.0)),
                            y = dpToPx(item.optDouble("y", 0.0)),
                            width = dpToPx(item.optDouble("width", 0.0)),
                            height = dpToPx(item.optDouble("height", 0.0)),
                            color = parseColor(item.optString("color", ""), Color.WHITE),
                            strokeWidth = dpToPx(item.optDouble("strokeWidth", 1.0)),
                            style = parsePaintStyle(item.optString("style", "fill")),
                        ),
                    )
                }
                "circle" -> {
                    parsed.add(
                        SkiaCommand.Circle(
                            cx = dpToPx(item.optDouble("cx", 0.0)),
                            cy = dpToPx(item.optDouble("cy", 0.0)),
                            r = dpToPx(item.optDouble("r", 0.0)),
                            color = parseColor(item.optString("color", ""), Color.WHITE),
                            strokeWidth = dpToPx(item.optDouble("strokeWidth", 1.0)),
                            style = parsePaintStyle(item.optString("style", "fill")),
                        ),
                    )
                }
                "line" -> {
                    parsed.add(
                        SkiaCommand.Line(
                            x1 = dpToPx(item.optDouble("x1", 0.0)),
                            y1 = dpToPx(item.optDouble("y1", 0.0)),
                            x2 = dpToPx(item.optDouble("x2", 0.0)),
                            y2 = dpToPx(item.optDouble("y2", 0.0)),
                            color = parseColor(item.optString("color", ""), Color.WHITE),
                            strokeWidth = dpToPx(item.optDouble("strokeWidth", 1.0)),
                        ),
                    )
                }
            }
        }
        return parsed
    }

    private fun parsePaintStyle(raw: String?): Paint.Style {
        return if (raw?.lowercase() == "stroke") Paint.Style.STROKE else Paint.Style.FILL
    }

    private fun parseColor(raw: String?, fallback: Int): Int {
        if (raw == null) return fallback
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return fallback
        return try {
            Color.parseColor(trimmed)
        } catch (_: Throwable) {
            fallback
        }
    }

    private fun dpToPx(value: Double): Float {
        return (value * density).toFloat()
    }

    private sealed class SkiaCommand {
        data class Clear(val color: Int) : SkiaCommand()
        data class Rect(
            val x: Float,
            val y: Float,
            val width: Float,
            val height: Float,
            val color: Int,
            val strokeWidth: Float,
            val style: Paint.Style,
        ) : SkiaCommand()

        data class Circle(
            val cx: Float,
            val cy: Float,
            val r: Float,
            val color: Int,
            val strokeWidth: Float,
            val style: Paint.Style,
        ) : SkiaCommand()

        data class Line(
            val x1: Float,
            val y1: Float,
            val x2: Float,
            val y2: Float,
            val color: Int,
            val strokeWidth: Float,
        ) : SkiaCommand()
    }
}
