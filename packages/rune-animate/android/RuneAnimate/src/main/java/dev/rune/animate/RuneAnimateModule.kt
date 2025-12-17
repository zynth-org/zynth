package dev.rune.animate

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.View
import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

private enum class Easing {
    LINEAR,
    EASE,
    EASE_IN,
    EASE_OUT,
    EASE_IN_OUT,
    EASE_OUT_CUBIC;

    fun apply(t: Float): Float {
        val clamped = min(1f, max(0f, t))
        return when (this) {
            LINEAR -> clamped
            EASE -> clamped * clamped * (3f - 2f * clamped)
            EASE_IN -> clamped * clamped
            EASE_OUT -> {
                val inv = 1f - clamped
                1f - inv * inv
            }
            EASE_IN_OUT -> {
                if (clamped < 0.5f) {
                    2f * clamped * clamped
                } else {
                    val inv = 1f - clamped
                    1f - 2f * inv * inv
                }
            }
            EASE_OUT_CUBIC -> {
                val inv = 1f - clamped
                1f - inv * inv * inv
            }
        }
    }

    companion object {
        fun fromName(name: String?): Easing {
            return when (name) {
                "linear" -> LINEAR
                "ease" -> EASE
                "easeIn" -> EASE_IN
                "easeOut" -> EASE_OUT
                "easeInOut" -> EASE_IN_OUT
                "easeOutCubic" -> EASE_OUT_CUBIC
                else -> EASE_OUT_CUBIC
            }
        }
    }
}

private data class AnimatedStyle(
    val opacity: Float? = null,
    val translateX: Float? = null,
    val translateY: Float? = null,
    val scale: Float? = null,
    val scaleX: Float? = null,
    val scaleY: Float? = null,
    val rotate: Float? = null,
)

private data class ResolvedStyle(
    val opacity: Float,
    val translateX: Float,
    val translateY: Float,
    val scaleX: Float,
    val scaleY: Float,
    val rotate: Float,
)

private data class ResolvedKeyframe(
    val at: Float,
    val style: ResolvedStyle,
    val easing: Easing? = null,
)

private data class StyleAnimation(
    val nodeId: Int,
    val animationId: Int,
    val phase: String,
    val from: ResolvedStyle,
    val to: ResolvedStyle,
    val frames: List<ResolvedKeyframe>? = null,
    val startTimeMs: Long,
    val durationMs: Long,
    val easing: Easing,
)

class RuneAnimateModule(
    private val runtime: RuneRuntime,
) : RuneModule {
    override val name: String = "RuneAnimate"

    private val handler = Handler(Looper.getMainLooper())
    private val choreographer = Choreographer.getInstance()
    private val animations = LinkedHashMap<Int, StyleAnimation>()
    private var frameCallback: Choreographer.FrameCallback? = null

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "startTransition" -> handleStartTransition(args)
            "stopTransition" -> handleStopTransition(args)
            else -> errorResponse("unsupported_method", method)
        }
    }

    fun onDestroy() {
        runOnMain {
            animations.clear()
            frameCallback?.let { choreographer.removeFrameCallback(it) }
            frameCallback = null
        }
    }

    private fun handleStartTransition(args: Array<Any?>): JSONObject {
        val params = args.firstOrNull()
        val nodeId = getIntParam(params, "nodeId") ?: return errorResponse("invalid_argument", "nodeId")

        val animationId = getIntParam(params, "animationId") ?: SystemClock.uptimeMillis().toInt()
        val phase = getStringParam(params, "phase") ?: "enter"
        val durationMs = getLongParam(params, "duration") ?: 300L
        val delayMs = getLongParam(params, "delay") ?: 0L
        val easingName = getStringParam(params, "easing")
        val easing = Easing.fromName(easingName)

        val fromStyle = parseStyle(getParam(params, "from"))
        val toStyle = parseStyle(getParam(params, "to"))
        val frameSpecs = parseKeyframes(getParam(params, "frames"))

        runOnMain {
            val view = runtime.getUIManager().getNodeView(nodeId) ?: return@runOnMain
            val resolvedFrames = if (frameSpecs.isNotEmpty()) {
                frameSpecs.map { frame ->
                    ResolvedKeyframe(
                        at = frame.at,
                        style = resolveStyle(frame.style, null, view),
                        easing = frame.easing,
                    )
                }.sortedBy { it.at }
            } else {
                null
            }
            val resolvedFrom = resolvedFrames?.firstOrNull()?.style
                ?: resolveStyle(fromStyle, toStyle, view)
            val resolvedTo = resolvedFrames?.lastOrNull()?.style
                ?: resolveStyle(toStyle, fromStyle, view)

            val startTime = SystemClock.uptimeMillis() + delayMs
            val animation = StyleAnimation(
                nodeId = nodeId,
                animationId = animationId,
                phase = phase,
                from = resolvedFrom,
                to = resolvedTo,
                frames = resolvedFrames,
                startTimeMs = startTime,
                durationMs = max(durationMs, 0L),
                easing = easing,
            )

            animations[nodeId] = animation
            applyStyle(resolvedFrom, view)

            if (durationMs <= 0L) {
                finishAnimation(animation)
            } else {
                ensureFrameCallback()
            }
        }

        return successResponse()
    }

    private fun handleStopTransition(args: Array<Any?>): JSONObject {
        val params = args.firstOrNull()
        val nodeId = getIntParam(params, "nodeId") ?: return errorResponse("invalid_argument", "nodeId")

        runOnMain {
            animations.remove(nodeId)
            stopFrameCallbackIfNeeded()
        }

        return successResponse()
    }

    private fun ensureFrameCallback() {
        if (frameCallback != null) return
        val callback = Choreographer.FrameCallback { frameTimeNanos ->
            step(frameTimeNanos / 1_000_000)
        }
        frameCallback = callback
        choreographer.postFrameCallback(callback)
    }

    private fun stopFrameCallbackIfNeeded() {
        if (animations.isNotEmpty()) return
        frameCallback?.let { choreographer.removeFrameCallback(it) }
        frameCallback = null
    }

    private fun step(frameTimeMs: Long) {
        val iterator = animations.values.toList().iterator()
        while (iterator.hasNext()) {
            val animation = iterator.next()
            if (frameTimeMs < animation.startTimeMs) continue
            val elapsed = frameTimeMs - animation.startTimeMs
            val duration = max(animation.durationMs, 1L)
            val progress = min(elapsed.toFloat() / duration.toFloat(), 1f)
            val eased = animation.easing.apply(progress)

            val view = runtime.getUIManager().getNodeView(animation.nodeId)
            if (view == null) {
                animations.remove(animation.nodeId)
                continue
            }

            val frames = animation.frames
            if (frames != null && frames.isNotEmpty()) {
                val interpolated = resolveKeyframe(frames, progress)
                applyStyle(interpolated, view)
            } else {
                val interpolated = interpolate(animation.from, animation.to, eased)
                applyStyle(interpolated, view)
            }

            if (progress >= 1f) {
                finishAnimation(animation)
            }
        }

        if (animations.isNotEmpty()) {
            frameCallback?.let { choreographer.postFrameCallback(it) }
        } else {
            stopFrameCallbackIfNeeded()
        }
    }

    private fun finishAnimation(animation: StyleAnimation) {
        animations.remove(animation.nodeId)
        val view = runtime.getUIManager().getNodeView(animation.nodeId)
        if (view != null) {
            applyStyle(animation.to, view)
        }
        runtime.emitEvent(
            "RuneAnimate:transitionEnd",
            mapOf(
                "nodeId" to animation.nodeId,
                "animationId" to animation.animationId,
                "phase" to animation.phase,
            )
        )
        stopFrameCallbackIfNeeded()
    }

    private fun applyStyle(style: ResolvedStyle, view: View) {
        val density = view.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        view.alpha = style.opacity
        view.translationX = style.translateX * density
        view.translationY = style.translateY * density
        view.scaleX = style.scaleX
        view.scaleY = style.scaleY
        view.rotation = style.rotate
    }

    private fun interpolate(from: ResolvedStyle, to: ResolvedStyle, progress: Float): ResolvedStyle {
        val t = min(1f, max(0f, progress))
        return ResolvedStyle(
            opacity = from.opacity + (to.opacity - from.opacity) * t,
            translateX = from.translateX + (to.translateX - from.translateX) * t,
            translateY = from.translateY + (to.translateY - from.translateY) * t,
            scaleX = from.scaleX + (to.scaleX - from.scaleX) * t,
            scaleY = from.scaleY + (to.scaleY - from.scaleY) * t,
            rotate = from.rotate + (to.rotate - from.rotate) * t,
        )
    }

    private fun resolveKeyframe(frames: List<ResolvedKeyframe>, progress: Float): ResolvedStyle {
        val clamped = min(1f, max(0f, progress))
        val first = frames.first()
        val last = frames.last()
        if (clamped <= first.at) {
            return first.style
        }
        if (clamped >= last.at) {
            return last.style
        }
        for (i in 1 until frames.size) {
            val current = frames[i]
            if (clamped <= current.at) {
                val prev = frames[i - 1]
                val span = max(current.at - prev.at, 0.0001f)
                val segmentProgress = (clamped - prev.at) / span
                val easing = current.easing ?: Easing.LINEAR
                val eased = easing.apply(segmentProgress)
                return interpolate(prev.style, current.style, eased)
            }
        }
        return last.style
    }

    private fun resolveStyle(from: AnimatedStyle?, to: AnimatedStyle?, view: View): ResolvedStyle {
        val density = view.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        val base = decomposeTransform(view)
        val opacity = resolveValue(from?.opacity, to?.opacity, view.alpha)
        val translateX = resolveValue(from?.translateX, to?.translateX, base.translateX / density)
        val translateY = resolveValue(from?.translateY, to?.translateY, base.translateY / density)
        val scaleX = resolveValue(from?.scaleX ?: from?.scale, to?.scaleX ?: to?.scale, base.scaleX)
        val scaleY = resolveValue(from?.scaleY ?: from?.scale, to?.scaleY ?: to?.scale, base.scaleY)
        val rotate = resolveValue(from?.rotate, to?.rotate, base.rotation)

        return ResolvedStyle(
            opacity = opacity,
            translateX = translateX,
            translateY = translateY,
            scaleX = scaleX,
            scaleY = scaleY,
            rotate = rotate,
        )
    }

    private fun resolveValue(primary: Float?, secondary: Float?, fallback: Float): Float {
        return primary ?: secondary ?: fallback
    }

    private fun decomposeTransform(view: View): TransformComponents {
        return TransformComponents(
            translateX = view.translationX,
            translateY = view.translationY,
            scaleX = view.scaleX,
            scaleY = view.scaleY,
            rotation = view.rotation,
        )
    }

    private data class TransformComponents(
        val translateX: Float,
        val translateY: Float,
        val scaleX: Float,
        val scaleY: Float,
        val rotation: Float,
    )

    private fun parseStyle(value: Any?): AnimatedStyle? {
        val map = when (value) {
            is JSONObject -> jsonToMap(value)
            is Map<*, *> -> value
            else -> null
        } ?: return null

        var opacity: Float? = getFloat(map, "opacity")
        var translateX: Float? = null
        var translateY: Float? = null
        var scale: Float? = null
        var scaleX: Float? = null
        var scaleY: Float? = null
        var rotate: Float? = null

        val transformValue = map["transform"]
        val transforms = when (transformValue) {
            is JSONArray -> jsonArrayToList(transformValue)
            is List<*> -> transformValue
            is Array<*> -> transformValue.toList()
            else -> emptyList()
        }

        for (entry in transforms) {
            val item = when (entry) {
                is JSONObject -> jsonToMap(entry)
                is Map<*, *> -> entry
                else -> null
            } ?: continue

            for ((key, rawValue) in item) {
                when (key as? String) {
                    "translateX" -> translateX = parseNumber(rawValue)
                    "translateY" -> translateY = parseNumber(rawValue)
                    "scale" -> scale = parseNumber(rawValue)
                    "scaleX" -> scaleX = parseNumber(rawValue)
                    "scaleY" -> scaleY = parseNumber(rawValue)
                    "rotate", "rotateZ" -> rotate = parseAngle(rawValue)
                }
            }
        }

        return AnimatedStyle(
            opacity = opacity,
            translateX = translateX,
            translateY = translateY,
            scale = scale,
            scaleX = scaleX,
            scaleY = scaleY,
            rotate = rotate,
        )
    }

    private data class KeyframeSpec(
        val at: Float,
        val style: AnimatedStyle?,
        val easing: Easing? = null,
    )

    private fun parseKeyframes(value: Any?): List<KeyframeSpec> {
        val list = when (value) {
            is JSONArray -> jsonArrayToList(value)
            is List<*> -> value
            is Array<*> -> value.toList()
            else -> emptyList()
        }
        if (list.isEmpty()) return emptyList()
        val frames = mutableListOf<KeyframeSpec>()
        for (entry in list) {
            val item = when (entry) {
                is JSONObject -> jsonToMap(entry)
                is Map<*, *> -> entry
                else -> null
            } ?: continue
            val at = getFloat(item, "at") ?: continue
            val style = parseStyle(item["style"])
            val easingName = getStringParam(item, "easing")
            val easing = easingName?.let { Easing.fromName(it) }
            frames.add(
                KeyframeSpec(
                    at = at.coerceIn(0f, 1f),
                    style = style,
                    easing = easing,
                )
            )
        }
        return frames
    }

    private fun parseAngle(value: Any?): Float? {
        if (value is Number) {
            return value.toFloat()
        }
        if (value !is String) return null
        val trimmed = value.trim()
        return when {
            trimmed.endsWith("deg") -> trimmed.removeSuffix("deg").toFloatOrNull()
            trimmed.endsWith("rad") -> {
                val radians = trimmed.removeSuffix("rad").toDoubleOrNull() ?: return null
                Math.toDegrees(radians).toFloat()
            }
            else -> trimmed.toFloatOrNull()
        }
    }

    private fun parseNumber(value: Any?): Float? {
        return when (value) {
            is Number -> value.toFloat()
            is String -> value.toFloatOrNull()
            else -> null
        }
    }

    private fun getParam(params: Any?, key: String): Any? {
        return when (params) {
            is JSONObject -> params.opt(key)
            is Map<*, *> -> params[key]
            else -> null
        }
    }

    private fun getStringParam(params: Any?, key: String): String? {
        val value = getParam(params, key)
        return value as? String
    }

    private fun getIntParam(params: Any?, key: String): Int? {
        val value = getParam(params, key)
        return when (value) {
            is Number -> value.toInt()
            is String -> value.toIntOrNull()
            else -> null
        }
    }

    private fun getLongParam(params: Any?, key: String): Long? {
        val value = getParam(params, key)
        return when (value) {
            is Number -> value.toLong()
            is String -> value.toLongOrNull()
            else -> null
        }
    }

    private fun getFloat(map: Map<*, *>, key: String): Float? {
        val value = map[key]
        return parseNumber(value)
    }

    private fun jsonToMap(json: JSONObject): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>()
        val keys = json.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            map[key] = json.opt(key)
        }
        return map
    }

    private fun jsonArrayToList(array: JSONArray): List<Any?> {
        val list = ArrayList<Any?>(array.length())
        for (i in 0 until array.length()) {
            list.add(array.opt(i))
        }
        return list
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            handler.post { block() }
        }
    }

    private fun successResponse(): JSONObject {
        return JSONObject().put("success", true)
    }

    private fun errorResponse(error: String, message: String): JSONObject {
        return JSONObject().put("error", error).put("message", message)
    }
}
