package com.rune.kit.core

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import kotlin.math.roundToInt

class RuneBorderDrawable : Drawable() {

    var backgroundColor: Int = Color.TRANSPARENT
    var borderTopWidth: Float = 0f
    var borderRightWidth: Float = 0f
    var borderBottomWidth: Float = 0f
    var borderLeftWidth: Float = 0f

    var borderTopColor: Int = Color.TRANSPARENT
    var borderRightColor: Int = Color.TRANSPARENT
    var borderBottomColor: Int = Color.TRANSPARENT
    var borderLeftColor: Int = Color.TRANSPARENT

    var borderTopLeftRadius: Float = 0f
    var borderTopRightRadius: Float = 0f
    var borderBottomRightRadius: Float = 0f
    var borderBottomLeftRadius: Float = 0f

    var borderStyle: String? = null // "solid", "dashed", "dotted"

    private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val path = Path()
    private val rectF = RectF()

    override fun draw(canvas: Canvas) {
        val bounds = bounds
        if (bounds.isEmpty) return

        val hasAnyBorderWidth = borderTopWidth > 0f || borderRightWidth > 0f || borderBottomWidth > 0f || borderLeftWidth > 0f
        val hasAnyBorderColor = borderTopColor != Color.TRANSPARENT || borderRightColor != Color.TRANSPARENT || borderBottomColor != Color.TRANSPARENT || borderLeftColor != Color.TRANSPARENT
        val hasAnyBorderRadius = borderTopLeftRadius > 0f || borderTopRightRadius > 0f || borderBottomRightRadius > 0f || borderBottomLeftRadius > 0f

        // Draw background
        if (backgroundColor != Color.TRANSPARENT || hasAnyBorderRadius) {
            backgroundPaint.color = backgroundColor
            path.reset()
            rectF.set(bounds)
            if (hasAnyBorderRadius) {
                val radii = floatArrayOf(
                    borderTopLeftRadius, borderTopLeftRadius,
                    borderTopRightRadius, borderTopRightRadius,
                    borderBottomRightRadius, borderBottomRightRadius,
                    borderBottomLeftRadius, borderBottomLeftRadius
                )
                path.addRoundRect(rectF, radii, Path.Direction.CW)
            } else {
                path.addRect(rectF, Path.Direction.CW)
            }
            canvas.drawPath(path, backgroundPaint)
        }

        // Draw borders if any
        if (hasAnyBorderWidth && hasAnyBorderColor) {
            val halfTop = borderTopWidth / 2f
            val halfRight = borderRightWidth / 2f
            val halfBottom = borderBottomWidth / 2f
            val halfLeft = borderLeftWidth / 2f

            val effectiveTopLeftRadius = borderTopLeftRadius.coerceAtLeast(0f)
            val effectiveTopRightRadius = borderTopRightRadius.coerceAtLeast(0f)
            val effectiveBottomRightRadius = borderBottomRightRadius.coerceAtLeast(0f)
            val effectiveBottomLeftRadius = borderBottomLeftRadius.coerceAtLeast(0f)

            // Re-draw background for clipping, potentially
            // This is a simplified approach, a more robust solution would involve proper path boolean operations
            // or separate layers/drawables for background and borders.

            // Draw top border
            if (borderTopWidth > 0f && borderTopColor != Color.TRANSPARENT) {
                borderPaint.color = borderTopColor
                borderPaint.strokeWidth = borderTopWidth
                applyBorderStyle(borderPaint, borderTopWidth, borderStyle)
                canvas.drawLine(
                    bounds.left + effectiveTopLeftRadius,
                    bounds.top + halfTop,
                    bounds.right - effectiveTopRightRadius,
                    bounds.top + halfTop,
                    borderPaint
                )
            }

            // Draw right border
            if (borderRightWidth > 0f && borderRightColor != Color.TRANSPARENT) {
                borderPaint.color = borderRightColor
                borderPaint.strokeWidth = borderRightWidth
                applyBorderStyle(borderPaint, borderRightWidth, borderStyle)
                canvas.drawLine(
                    bounds.right - halfRight,
                    bounds.top + effectiveTopRightRadius,
                    bounds.right - halfRight,
                    bounds.bottom - effectiveBottomRightRadius,
                    borderPaint
                )
            }

            // Draw bottom border
            if (borderBottomWidth > 0f && borderBottomColor != Color.TRANSPARENT) {
                borderPaint.color = borderBottomColor
                borderPaint.strokeWidth = borderBottomWidth
                applyBorderStyle(borderPaint, borderBottomWidth, borderStyle)
                canvas.drawLine(
                    bounds.left + effectiveBottomLeftRadius,
                    bounds.bottom - halfBottom,
                    bounds.right - effectiveBottomRightRadius,
                    bounds.bottom - halfBottom,
                    borderPaint
                )
            }

            // Draw left border
            if (borderLeftWidth > 0f && borderLeftColor != Color.TRANSPARENT) {
                borderPaint.color = borderLeftColor
                borderPaint.strokeWidth = borderLeftWidth
                applyBorderStyle(borderPaint, borderLeftWidth, borderStyle)
                canvas.drawLine(
                    bounds.left + halfLeft,
                    bounds.top + effectiveTopLeftRadius,
                    bounds.left + halfLeft,
                    bounds.bottom - effectiveBottomLeftRadius,
                    borderPaint
                )
            }
            // Draw corners - this is a simplified approach, a more complex path would be needed for perfect corners
            // Top-left corner
            if (effectiveTopLeftRadius > 0f && borderTopWidth > 0f && borderLeftWidth > 0f && borderTopColor != Color.TRANSPARENT && borderLeftColor != Color.TRANSPARENT) {
                borderPaint.color = borderTopColor // or borderLeftColor, depends on desired blending
                borderPaint.strokeWidth = borderTopWidth.coerceAtLeast(borderLeftWidth)
                applyBorderStyle(borderPaint, borderTopWidth.coerceAtLeast(borderLeftWidth), borderStyle)
                rectF.set(
                    bounds.left + halfLeft,
                    bounds.top + halfTop,
                    bounds.left + effectiveTopLeftRadius * 2,
                    bounds.top + effectiveTopLeftRadius * 2
                )
                canvas.drawArc(rectF, 180f, 90f, false, borderPaint)
            }

            // Top-right corner
            if (effectiveTopRightRadius > 0f && borderTopWidth > 0f && borderRightWidth > 0f && borderTopColor != Color.TRANSPARENT && borderRightColor != Color.TRANSPARENT) {
                borderPaint.color = borderTopColor
                borderPaint.strokeWidth = borderTopWidth.coerceAtLeast(borderRightWidth)
                applyBorderStyle(borderPaint, borderTopWidth.coerceAtLeast(borderRightWidth), borderStyle)
                rectF.set(
                    bounds.right - effectiveTopRightRadius * 2,
                    bounds.top + halfTop,
                    bounds.right - halfRight,
                    bounds.top + effectiveTopRightRadius * 2
                )
                canvas.drawArc(rectF, 270f, 90f, false, borderPaint)
            }

            // Bottom-right corner
            if (effectiveBottomRightRadius > 0f && borderBottomWidth > 0f && borderRightWidth > 0f && borderBottomColor != Color.TRANSPARENT && borderRightColor != Color.TRANSPARENT) {
                borderPaint.color = borderBottomColor
                borderPaint.strokeWidth = borderBottomWidth.coerceAtLeast(borderRightWidth)
                applyBorderStyle(borderPaint, borderBottomWidth.coerceAtLeast(borderRightWidth), borderStyle)
                rectF.set(
                    bounds.right - effectiveBottomRightRadius * 2,
                    bounds.bottom - effectiveBottomRightRadius * 2,
                    bounds.right - halfRight,
                    bounds.bottom - halfBottom
                )
                canvas.drawArc(rectF, 0f, 90f, false, borderPaint)
            }

            // Bottom-left corner
            if (effectiveBottomLeftRadius > 0f && borderBottomWidth > 0f && borderLeftWidth > 0f && borderBottomColor != Color.TRANSPARENT && borderLeftColor != Color.TRANSPARENT) {
                borderPaint.color = borderBottomColor
                borderPaint.strokeWidth = borderBottomWidth.coerceAtLeast(borderLeftWidth)
                applyBorderStyle(borderPaint, borderBottomWidth.coerceAtLeast(borderLeftWidth), borderStyle)
                rectF.set(
                    bounds.left + halfLeft,
                    bounds.bottom - effectiveBottomLeftRadius * 2,
                    bounds.left + effectiveBottomLeftRadius * 2,
                    bounds.bottom - halfBottom
                )
                canvas.drawArc(rectF, 90f, 90f, false, borderPaint)
            }
        }
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
        invalidateSelf()
    }
}
