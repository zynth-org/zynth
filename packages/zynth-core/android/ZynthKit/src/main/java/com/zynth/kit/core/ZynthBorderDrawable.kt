package com.zynth.kit.core

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Outline
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

class ZynthBorderDrawable : Drawable() {
    var renderBorderOnTop: Boolean = false

    var backgroundColor: Int = Color.TRANSPARENT
        set(value) {
            field = value
            invalidateSelf()
        }

    var backgroundGradient: ZynthLinearGradient? = null
        set(value) {
            field = value
            updateShader()
            invalidateSelf()
        }

    var borderTopWidth: Float = 0f
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderRightWidth: Float = 0f
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderBottomWidth: Float = 0f
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderLeftWidth: Float = 0f
        set(value) {
            field = value
            invalidateSelf()
        }

    var borderTopColor: Int = Color.TRANSPARENT
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderRightColor: Int = Color.TRANSPARENT
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderBottomColor: Int = Color.TRANSPARENT
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderLeftColor: Int = Color.TRANSPARENT
        set(value) {
            field = value
            invalidateSelf()
        }

    var borderTopLeftRadius: Float = 0f
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderTopRightRadius: Float = 0f
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderBottomRightRadius: Float = 0f
        set(value) {
            field = value
            invalidateSelf()
        }
    var borderBottomLeftRadius: Float = 0f
        set(value) {
            field = value
            invalidateSelf()
        }

    var borderStyle: String? = null
        set(value) {
            field = value
            invalidateSelf()
        }

    private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val path = Path()
    private val rectF = RectF()
    private val tempOutlineRect = Rect()

    override fun draw(canvas: Canvas) {
        render(canvas, drawBackground = true, drawBorder = !renderBorderOnTop)
    }

    fun drawBorder(canvas: Canvas) {
        if (!renderBorderOnTop) return
        render(canvas, drawBackground = false, drawBorder = true)
    }

    private fun render(canvas: Canvas, drawBackground: Boolean, drawBorder: Boolean) {
        val bounds = bounds
        if (bounds.isEmpty) return

        val w = bounds.width().toFloat()
        val h = bounds.height().toFloat()

        // CSS-like radius constraint scaling
        var scale = 1f
        if (borderTopLeftRadius + borderTopRightRadius > w) {
            scale = minOf(scale, w / (borderTopLeftRadius + borderTopRightRadius))
        }
        if (borderTopRightRadius + borderBottomRightRadius > h) {
            scale = minOf(scale, h / (borderTopRightRadius + borderBottomRightRadius))
        }
        if (borderBottomRightRadius + borderBottomLeftRadius > w) {
            scale = minOf(scale, w / (borderBottomRightRadius + borderBottomLeftRadius))
        }
        if (borderBottomLeftRadius + borderTopLeftRadius > h) {
            scale = minOf(scale, h / (borderBottomLeftRadius + borderTopLeftRadius))
        }

        val effTopLeft = (borderTopLeftRadius * scale).coerceAtLeast(0f)
        val effTopRight = (borderTopRightRadius * scale).coerceAtLeast(0f)
        val effBottomRight = (borderBottomRightRadius * scale).coerceAtLeast(0f)
        val effBottomLeft = (borderBottomLeftRadius * scale).coerceAtLeast(0f)

        val hasAnyBorderWidth = borderTopWidth > 0f || borderRightWidth > 0f || borderBottomWidth > 0f || borderLeftWidth > 0f
        val hasAnyBorderColor = borderTopColor != Color.TRANSPARENT || borderRightColor != Color.TRANSPARENT || borderBottomColor != Color.TRANSPARENT || borderLeftColor != Color.TRANSPARENT
        val hasAnyBorderRadius = effTopLeft > 0f || effTopRight > 0f || effBottomRight > 0f || effBottomLeft > 0f
        
        if (drawBackground && (backgroundGradient != null || backgroundColor != Color.TRANSPARENT || hasAnyBorderRadius)) {
            backgroundPaint.color = backgroundColor
            backgroundPaint.alpha = if (backgroundGradient != null) 255 else Color.alpha(backgroundColor)
            path.reset()
            rectF.set(bounds)
            if (hasAnyBorderRadius) {
                val radii = floatArrayOf(
                    effTopLeft, effTopLeft,
                    effTopRight, effTopRight,
                    effBottomRight, effBottomRight,
                    effBottomLeft, effBottomLeft
                )
                path.addRoundRect(rectF, radii, Path.Direction.CW)
            } else {
                path.addRect(rectF, Path.Direction.CW)
            }
            canvas.drawPath(path, backgroundPaint)
        }

        if (drawBorder && hasAnyBorderWidth && hasAnyBorderColor) {
            val halfTop = borderTopWidth / 2f
            val halfRight = borderRightWidth / 2f
            val halfBottom = borderBottomWidth / 2f
            val halfLeft = borderLeftWidth / 2f

            if (borderTopWidth > 0f && borderTopColor != Color.TRANSPARENT) {
                borderPaint.color = borderTopColor
                borderPaint.strokeWidth = borderTopWidth
                applyBorderStyle(borderPaint, borderTopWidth, borderStyle)
                canvas.drawLine(
                    bounds.left + effTopLeft,
                    bounds.top + halfTop,
                    bounds.right - effTopRight,
                    bounds.top + halfTop,
                    borderPaint
                )
            }

            if (borderRightWidth > 0f && borderRightColor != Color.TRANSPARENT) {
                borderPaint.color = borderRightColor
                borderPaint.strokeWidth = borderRightWidth
                applyBorderStyle(borderPaint, borderRightWidth, borderStyle)
                canvas.drawLine(
                    bounds.right - halfRight,
                    bounds.top + effTopRight,
                    bounds.right - halfRight,
                    bounds.bottom - effBottomRight,
                    borderPaint
                )
            }

            if (borderBottomWidth > 0f && borderBottomColor != Color.TRANSPARENT) {
                borderPaint.color = borderBottomColor
                borderPaint.strokeWidth = borderBottomWidth
                applyBorderStyle(borderPaint, borderBottomWidth, borderStyle)
                canvas.drawLine(
                    bounds.left + effBottomLeft,
                    bounds.bottom - halfBottom,
                    bounds.right - effBottomRight,
                    bounds.bottom - halfBottom,
                    borderPaint
                )
            }

            if (borderLeftWidth > 0f && borderLeftColor != Color.TRANSPARENT) {
                borderPaint.color = borderLeftColor
                borderPaint.strokeWidth = borderLeftWidth
                applyBorderStyle(borderPaint, borderLeftWidth, borderStyle)
                canvas.drawLine(
                    bounds.left + halfLeft,
                    bounds.top + effTopLeft,
                    bounds.left + halfLeft,
                    bounds.bottom - effBottomLeft,
                    borderPaint
                )
            }
            if (effTopLeft > 0f && borderTopWidth > 0f && borderLeftWidth > 0f && borderTopColor != Color.TRANSPARENT && borderLeftColor != Color.TRANSPARENT) {
                borderPaint.color = borderTopColor
                borderPaint.strokeWidth = borderTopWidth.coerceAtLeast(borderLeftWidth)
                applyBorderStyle(borderPaint, borderTopWidth.coerceAtLeast(borderLeftWidth), borderStyle)
                rectF.set(
                    bounds.left + halfLeft,
                    bounds.top + halfTop,
                    bounds.left + effTopLeft * 2,
                    bounds.top + effTopLeft * 2
                )
                canvas.drawArc(rectF, 180f, 90f, false, borderPaint)
            }

            if (effTopRight > 0f && borderTopWidth > 0f && borderRightWidth > 0f && borderTopColor != Color.TRANSPARENT && borderRightColor != Color.TRANSPARENT) {
                borderPaint.color = borderTopColor
                borderPaint.strokeWidth = borderTopWidth.coerceAtLeast(borderRightWidth)
                applyBorderStyle(borderPaint, borderTopWidth.coerceAtLeast(borderRightWidth), borderStyle)
                rectF.set(
                    bounds.right - effTopRight * 2,
                    bounds.top + halfTop,
                    bounds.right - halfRight,
                    bounds.top + effTopRight * 2
                )
                canvas.drawArc(rectF, 270f, 90f, false, borderPaint)
            }

            if (effBottomRight > 0f && borderBottomWidth > 0f && borderRightWidth > 0f && borderBottomColor != Color.TRANSPARENT && borderRightColor != Color.TRANSPARENT) {
                borderPaint.color = borderBottomColor
                borderPaint.strokeWidth = borderBottomWidth.coerceAtLeast(borderRightWidth)
                applyBorderStyle(borderPaint, borderBottomWidth.coerceAtLeast(borderRightWidth), borderStyle)
                rectF.set(
                    bounds.right - effBottomRight * 2,
                    bounds.bottom - effBottomRight * 2,
                    bounds.right - halfRight,
                    bounds.bottom - halfBottom
                )
                canvas.drawArc(rectF, 0f, 90f, false, borderPaint)
            }

            if (effBottomLeft > 0f && borderBottomWidth > 0f && borderLeftWidth > 0f && borderBottomColor != Color.TRANSPARENT && borderLeftColor != Color.TRANSPARENT) {
                borderPaint.color = borderBottomColor
                borderPaint.strokeWidth = borderBottomWidth.coerceAtLeast(borderLeftWidth)
                applyBorderStyle(borderPaint, borderBottomWidth.coerceAtLeast(borderLeftWidth), borderStyle)
                rectF.set(
                    bounds.left + halfLeft,
                    bounds.bottom - effBottomLeft * 2,
                    bounds.left + effBottomLeft * 2,
                    bounds.bottom - halfBottom
                )
                canvas.drawArc(rectF, 90f, 90f, false, borderPaint)
            }
        }
    }

    override fun getOutline(outline: Outline) {
        copyBounds(tempOutlineRect)
        if (tempOutlineRect.isEmpty) {
            outline.setEmpty()
            return
        }
        val maxRadius = maxOf(
            borderTopLeftRadius,
            borderTopRightRadius,
            borderBottomRightRadius,
            borderBottomLeftRadius,
        ).coerceAtLeast(0f)
        if (maxRadius > 0f) {
            outline.setRoundRect(tempOutlineRect, maxRadius)
        } else {
            outline.setRect(tempOutlineRect)
        }
        outline.alpha = 1.0f
    }

    private fun applyBorderStyle(paint: Paint, strokeWidth: Float, style: String?) {
        when (style) {
            "dashed" -> {
                val dash = strokeWidth * 3f
                paint.pathEffect = DashPathEffect(floatArrayOf(dash, dash * 2f), 0f)
            }
            "dotted" -> {
                val dash = strokeWidth
                paint.pathEffect = DashPathEffect(floatArrayOf(dash, dash * 1.5f), 0f)
            }
            else -> paint.pathEffect = null
        }
    }

    override fun setAlpha(alpha: Int) {
        backgroundPaint.alpha = alpha
        borderPaint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        backgroundPaint.colorFilter = colorFilter
        borderPaint.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    override fun onBoundsChange(bounds: Rect) {
        super.onBoundsChange(bounds)
        updateShader()
        invalidateSelf()
    }

    private fun updateShader() {
        val gradient = backgroundGradient
        val b = bounds
        if (gradient == null || gradient.stops.size < 2 || b.width() <= 0 || b.height() <= 0) {
            backgroundPaint.shader = null
            return
        }

        val positions = resolvePositions(gradient.stops)
        val colors = gradient.stops.map { it.color }.toIntArray()

        val angleRad = gradient.angle.toDouble() * PI / 180.0
        val dx = sin(angleRad)
        val dy = -cos(angleRad)
        val cx = b.exactCenterX()
        val cy = b.exactCenterY()
        val radius = hypot(b.width().toDouble(), b.height().toDouble()) / 2.0

        val startX = (cx - dx * radius).toFloat()
        val startY = (cy - dy * radius).toFloat()
        val endX = (cx + dx * radius).toFloat()
        val endY = (cy + dy * radius).toFloat()

        backgroundPaint.shader = LinearGradient(
            startX, startY, endX, endY,
            colors,
            positions,
            Shader.TileMode.CLAMP
        )
    }

    private fun resolvePositions(stops: List<ZynthGradientStop>): FloatArray {
        val n = stops.size
        val positions = FloatArray(n) { Float.NaN }
        var lastIdx = -1
        var lastPos = 0f

        for (i in 0 until n) {
            val raw = stops[i].position
            if (raw != null) {
                val clamped = raw.coerceIn(0f, 1f)
                positions[i] = clamped
                if (lastIdx == -1) {
                    if (i > 0) {
                        val step = clamped / (i + 1)
                        for (k in 0 until i) {
                            positions[k] = step * (k + 1)
                        }
                    }
                } else if (i - lastIdx > 1) {
                    val span = i - lastIdx
                    val step = (clamped - lastPos) / span
                    for (k in lastIdx + 1 until i) {
                        positions[k] = lastPos + step * (k - lastIdx)
                    }
                }
                lastIdx = i
                lastPos = clamped
            }
        }

        if (lastIdx == -1) {
            if (n == 1) {
                positions[0] = 0f
            } else {
                val step = 1f / (n - 1)
                for (i in 0 until n) {
                    positions[i] = step * i
                }
            }
        } else if (lastIdx < n - 1) {
            val span = (n - 1) - lastIdx
            val step = (1f - lastPos) / span
            for (k in lastIdx + 1 until n) {
                positions[k] = lastPos + step * (k - lastIdx)
            }
        }

        var prev = positions[0].let { if (it.isNaN()) 0f else it }.coerceIn(0f, 1f)
        positions[0] = prev
        for (i in 1 until n) {
            var p = positions[i]
            if (p.isNaN()) p = prev
            p = p.coerceIn(0f, 1f)
            if (p < prev) p = prev
            positions[i] = p
            prev = p
        }

        return positions
    }
}
