package com.zynth.kit.runtime.animate

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.View
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

private const val DEFAULT_PERSPECTIVE = 500f

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
    val rotateX: Float? = null,
    val rotateY: Float? = null,
    val skewX: Float? = null,
    val skewY: Float? = null,
    val perspective: Float? = null,
)

private data class ResolvedStyle(
    val opacity: Float,
    val translateX: Float,
    val translateY: Float,
    val scaleX: Float,
    val scaleY: Float,
    val rotate: Float,
    val rotateX: Float,
    val rotateY: Float,
    val skewX: Float,
    val skewY: Float,
    val perspective: Float,
    val hasPerspective: Boolean,
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

class ZynthAnimateModule(
    private val runtime: ZynthRuntime,
) : ZynthModule {
    override val name: String = "ZynthAnimate"

    override val exportedMethods: List<String> = listOf("startTransition", "stopTransition")

    private val handler = Handler(Looper.getMainLooper())
    private val choreographer = Choreographer.getInstance()
    private val animations = LinkedHashMap<Int, StyleAnimation>()
    private var frameCallback: Choreographer.FrameCallback? = null

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "startTransition" -> resultResponse(handleStartTransition(args))
            "stopTransition" -> resultResponse(handleStopTransition(args))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    fun onDestroy() {
        runOnMain {
            animations.clear()
            frameCallback?.let { choreographer.removeFrameCallback(it) }
            frameCallback = null
        }
    }

    private fun handleStartTransition(params: ZynthArgs): JSONObject {
        val nodeId = params.getInt("nodeId")

        val animationId = try { params.getInt("animationId") } catch (e: Exception) { SystemClock.uptimeMillis().toInt() }
        val phase = params.getString("phase", "enter")
        val durationMs = (try { params.getDouble("duration") } catch (e: Exception) { 300.0 }).toLong()
        val delayMs = (try { params.getDouble("delay") } catch (e: Exception) { 0.0 }).toLong()
        val easingName = params.getOptionalString("easing")
        val easing = Easing.fromName(easingName)

        val fromStyle = parseStyle(try { params.nested("from") } catch (e: Exception) { null })
        val toStyle = parseStyle(try { params.nested("to") } catch (e: Exception) { null })
        val frameSpecs = parseKeyframes(try { params.nested("frames") } catch (e: Exception) { null })

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

        return JSONObject().put("success", true)
    }

    private fun handleStopTransition(params: ZynthArgs): JSONObject {
        val nodeId = params.getInt("nodeId")

        runOnMain {
            animations.remove(nodeId)
            stopFrameCallbackIfNeeded()
        }

        return JSONObject().put("success", true)
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
            "ZynthAnimate:transitionEnd",
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
        val has3dRotation = kotlin.math.abs(style.rotateX) > 0.001f || kotlin.math.abs(style.rotateY) > 0.001f
        if (has3dRotation) {
            val euler = computeEulerForRotateXY(style.rotateX, style.rotateY)
            view.rotationX = -euler.x
            view.rotationY = -euler.y
            view.rotation = if (style.rotate == 0f) euler.z else style.rotate
        } else {
            view.rotation = style.rotate
            view.rotationX = -style.rotateX
            view.rotationY = -style.rotateY
        }
        if (style.hasPerspective && style.perspective > 0f) {
            view.cameraDistance = style.perspective * density
        } else if (has3dRotation) {
            // Align default 3D perspective with iOS/CSS when not explicitly provided.
            view.cameraDistance = DEFAULT_PERSPECTIVE * density
        }

        val hasSkew = kotlin.math.abs(style.skewX) > 0.001f || kotlin.math.abs(style.skewY) > 0.001f
        if (hasSkew) {
            val matrix = android.graphics.Matrix()
            val radX = Math.toRadians(style.skewX.toDouble()).toFloat()
            val radY = Math.toRadians(style.skewY.toDouble()).toFloat()

            // Pivot logic to match View rotation/scale behavior
            val px = view.pivotX
            val py = view.pivotY
            matrix.setTranslate(-px, -py)

            val skew = android.graphics.Matrix()
            skew.setValues(
                floatArrayOf(
                    1f,
                    Math.tan(radX.toDouble()).toFloat(),
                    0f,
                    Math.tan(radY.toDouble()).toFloat(),
                    1f,
                    0f,
                    0f,
                    0f,
                    1f,
                )
            )
            matrix.postConcat(skew)
            matrix.postTranslate(px, py)

            view.setLayerType(View.LAYER_TYPE_HARDWARE, null)
            view.setAnimationMatrix(matrix)
        } else {
            view.setAnimationMatrix(null)
            view.setLayerType(View.LAYER_TYPE_NONE, null)
        }
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
            rotateX = from.rotateX + (to.rotateX - from.rotateX) * t,
            rotateY = from.rotateY + (to.rotateY - from.rotateY) * t,
            skewX = from.skewX + (to.skewX - from.skewX) * t,
            skewY = from.skewY + (to.skewY - from.skewY) * t,
            perspective = from.perspective + (to.perspective - from.perspective) * t,
            hasPerspective = from.hasPerspective || to.hasPerspective,
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
        val rotateX = resolveValue(from?.rotateX, to?.rotateX, -base.rotationX)
        val rotateY = resolveValue(from?.rotateY, to?.rotateY, -base.rotationY)
        val skewX = resolveValue(from?.skewX, to?.skewX, 0f)
        val skewY = resolveValue(from?.skewY, to?.skewY, 0f)
        val perspective = resolveValue(
            from?.perspective,
            to?.perspective,
            base.perspective / density,
        )
        val hasPerspective = from?.perspective != null || to?.perspective != null

        return ResolvedStyle(
            opacity = opacity,
            translateX = translateX,
            translateY = translateY,
            scaleX = scaleX,
            scaleY = scaleY,
            rotate = rotate,
            rotateX = rotateX,
            rotateY = rotateY,
            skewX = skewX,
            skewY = skewY,
            perspective = perspective,
            hasPerspective = hasPerspective,
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
            rotationX = view.rotationX,
            rotationY = view.rotationY,
            perspective = view.cameraDistance,
        )
    }

    private data class TransformComponents(
        val translateX: Float,
        val translateY: Float,
        val scaleX: Float,
        val scaleY: Float,
        val rotation: Float,
        val rotationX: Float,
        val rotationY: Float,
        val perspective: Float,
    )

    private data class EulerAngles(val x: Float, val y: Float, val z: Float)

    private fun computeEulerForRotateXY(rotateX: Float, rotateY: Float): EulerAngles {
        val rx = Math.toRadians(rotateX.toDouble())
        val ry = Math.toRadians(rotateY.toDouble())
        val rotateXMatrix = identityMatrix().apply { applyRotateX(this, rx) }
        val rotateYMatrix = identityMatrix().apply { applyRotateY(this, ry) }

        // combined matrices
        val combined = multiplyMatrices(rotateYMatrix, rotateXMatrix)
        return extractEulerFromMatrix(combined)
    }

    private fun identityMatrix(): DoubleArray {
        return doubleArrayOf(
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    private fun applyRotateX(matrix: DoubleArray, radians: Double) {
        val cos = kotlin.math.cos(radians)
        val sin = kotlin.math.sin(radians)
        matrix[5] = cos
        matrix[6] = sin
        matrix[9] = -sin
        matrix[10] = cos
    }

    private fun applyRotateY(matrix: DoubleArray, radians: Double) {
        val cos = kotlin.math.cos(radians)
        val sin = kotlin.math.sin(radians)
        matrix[0] = cos
        matrix[2] = -sin
        matrix[8] = sin
        matrix[10] = cos
    }

    private fun multiplyMatrices(a: DoubleArray, b: DoubleArray): DoubleArray {
        val out = DoubleArray(16)
        for (c in 0..3) {
            val cIndex = c * 4
            for (r in 0..3) {
                out[cIndex + r] =
                    a[r + 0] * b[cIndex + 0] +
                        a[r + 4] * b[cIndex + 1] +
                        a[r + 8] * b[cIndex + 2] +
                        a[r + 12] * b[cIndex + 3]
            }
        }
        return out
    }

    private fun extractEulerFromMatrix(matrix: DoubleArray): EulerAngles {
        val r00 = matrix[0]
        val r01 = matrix[4]
        val r02 = matrix[8]
        val r12 = matrix[9]
        val r22 = matrix[10]

        val sinRy = -r02
        val ry = kotlin.math.asin(sinRy.coerceIn(-1.0, 1.0))
        val rx = if (kotlin.math.abs(sinRy) >= 1.0) {
            kotlin.math.atan2(sinRy * r01, sinRy * r02)
        } else {
            kotlin.math.atan2(r12, r22)
        }
        val rz = kotlin.math.atan2(r01, r00)

        return EulerAngles(
            x = Math.toDegrees(rx).toFloat(),
            y = Math.toDegrees(ry).toFloat(),
            z = Math.toDegrees(rz).toFloat(),
        )
    }

    private fun parseStyle(args: ZynthArgs?): AnimatedStyle? {
        if (args == null) return null

        var opacity: Float? = try { args.getDouble("opacity").toFloat() } catch (e: Exception) { null }
        var translateX: Float? = null
        var translateY: Float? = null
        var scale: Float? = null
        var scaleX: Float? = null
        var scaleY: Float? = null
        var rotate: Float? = null
        var rotateX: Float? = null
        var rotateY: Float? = null
        var skewX: Float? = null
        var skewY: Float? = null
        var perspective: Float? = null

        val transforms = try { args.getList("transform") } catch (e: Exception) { emptyList<Any?>() }

        for (entry in transforms) {
            val item = if (entry is Map<*, *>) entry else continue

            for ((key, rawValue) in item) {
                when (key as? String) {
                    "translateX" -> translateX = parseNumber(rawValue)
                    "translateY" -> translateY = parseNumber(rawValue)
                    "scale" -> scale = parseNumber(rawValue)
                    "scaleX" -> scaleX = parseNumber(rawValue)
                    "scaleY" -> scaleY = parseNumber(rawValue)
                    "rotate", "rotateZ" -> rotate = parseAngle(rawValue)
                    "rotateX" -> rotateX = parseAngle(rawValue)
                    "rotateY" -> rotateY = parseAngle(rawValue)
                    "skewX" -> skewX = parseAngle(rawValue)
                    "skewY" -> skewY = parseAngle(rawValue)
                    "perspective" -> perspective = parseNumber(rawValue)
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
            rotateX = rotateX,
            rotateY = rotateY,
            skewX = skewX,
            skewY = skewY,
            perspective = perspective,
        )
    }

    private data class KeyframeSpec(
        val at: Float,
        val style: AnimatedStyle?,
        val easing: Easing? = null,
    )

    private fun parseKeyframes(args: ZynthArgs?): List<KeyframeSpec> {
        if (args == null) return emptyList()
        val list = try { args.asArray() } catch (e: Exception) { emptyArray<Any?>() }
        if (list.isEmpty()) return emptyList()
        
        val frames = mutableListOf<KeyframeSpec>()
        for (i in list.indices) {
            val item = args.nestedAt(i)
            val at = try { item.getDouble("at").toFloat() } catch (e: Exception) { continue }
            val style = parseStyle(try { item.nested("style") } catch (e: Exception) { null })
            val easingName = item.getOptionalString("easing")
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

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            handler.post { block() }
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
