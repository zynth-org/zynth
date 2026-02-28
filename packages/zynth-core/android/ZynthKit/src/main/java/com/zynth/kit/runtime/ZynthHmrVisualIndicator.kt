package com.zynth.kit.runtime

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.core.graphics.Insets
import androidx.core.view.WindowInsetsCompat
import com.zynth.kit.core.ZynthRootView
import java.lang.ref.WeakReference

internal object ZynthHmrVisualIndicator {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var rootRef: WeakReference<ZynthRootView>? = null
  private var drawable: HmrPulseDrawable? = null
  private var pulseAnimator: ValueAnimator? = null

  fun pulse(root: ZynthRootView) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      pulseOnMain(root)
    } else {
      mainHandler.post { pulseOnMain(root) }
    }
  }

  fun dismiss() {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      dismissOnMain()
    } else {
      mainHandler.post { dismissOnMain() }
    }
  }

  private fun pulseOnMain(root: ZynthRootView) {
    if (root.width <= 0 || root.height <= 0) {
      root.post { pulseOnMain(root) }
      return
    }

    val previousRoot = rootRef?.get()
    if (previousRoot !== root) {
      previousRoot?.overlay?.let { previousOverlay ->
        drawable?.let { previousOverlay.remove(it) }
      }
    }

    rootRef = WeakReference(root)
    val indicator = drawable ?: HmrPulseDrawable().also { drawable = it }
    val cornerRadius = resolveCornerRadius(root)
    indicator.configure(widthPx = root.width, heightPx = root.height, cornerRadiusPx = cornerRadius)

    root.overlay.remove(indicator)
    root.overlay.add(indicator)

    pulseAnimator?.cancel()
    pulseAnimator = ValueAnimator.ofFloat(0f, 1f, 0f).apply {
      duration = 350L
      interpolator = AccelerateDecelerateInterpolator()
      addUpdateListener { animation ->
        val value = animation.animatedValue as Float
        indicator.setPulseProgress(value)
      }
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          if (pulseAnimator !== animation) return
          root.overlay.remove(indicator)
          pulseAnimator = null
        }

        override fun onAnimationCancel(animation: Animator) {
          root.overlay.remove(indicator)
        }
      })
      start()
    }
  }

  private fun dismissOnMain() {
    pulseAnimator?.cancel()
    pulseAnimator = null
    val root = rootRef?.get()
    val indicator = drawable
    if (root != null && indicator != null) {
      root.overlay.remove(indicator)
    }
    rootRef = null
  }

  private fun resolveCornerRadius(root: ZynthRootView): Float {
    val systemInsets = root.rootWindowInsets?.let {
      WindowInsetsCompat.toWindowInsetsCompat(it, root)
    }?.getInsets(WindowInsetsCompat.Type.systemBars()) ?: Insets.NONE

    val hasCutout = root.rootWindowInsets?.displayCutout != null
    val hasSideInsets = systemInsets.left > 0 || systemInsets.right > 0
    if (hasCutout || hasSideInsets) {
      return root.resources.displayMetrics.density * 28f
    }

    return 0f
  }
}

private class HmrPulseDrawable : Drawable() {
  private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
  }
  private val gradientRect = RectF()
  private val ringPath = Path()
  private val outerRect = RectF()
  private val innerRect = RectF()

  private var pulseProgress = 0f
  private var baseShader: Shader? = null
  private var cornerRadiusPx = 0f
  private var edgeThicknessPx = 0f
  private var innerCornerPx = 0f

  fun configure(widthPx: Int, heightPx: Int, cornerRadiusPx: Float) {
    this.cornerRadiusPx = cornerRadiusPx.coerceAtLeast(0f)
    setBounds(0, 0, widthPx, heightPx)
    rebuildGeometryAndShaders(bounds)
  }

  fun setPulseProgress(value: Float) {
    pulseProgress = value.coerceIn(0f, 1f)
    invalidateSelf()
  }

  override fun onBoundsChange(bounds: Rect) {
    super.onBoundsChange(bounds)
    rebuildGeometryAndShaders(bounds)
  }

  private fun rebuildGeometryAndShaders(bounds: Rect) {
    val width = bounds.width().toFloat()
    val height = bounds.height().toFloat()
    val shortest = width.coerceAtMost(height)
    edgeThicknessPx = (shortest * 0.051f).coerceIn(21f, 33f)

    gradientRect.set(
      bounds.left.toFloat(),
      bounds.top.toFloat(),
      bounds.right.toFloat(),
      bounds.bottom.toFloat(),
    )
    outerRect.set(gradientRect)
    innerRect.set(
      gradientRect.left + edgeThicknessPx,
      gradientRect.top + edgeThicknessPx,
      gradientRect.right - edgeThicknessPx,
      gradientRect.bottom - edgeThicknessPx,
    )
    val targetInnerCorner =
      if (cornerRadiusPx > 0f) {
        (cornerRadiusPx * 0.42f).coerceIn(10f, 24f)
      } else {
        0f
      }
    innerCornerPx =
      if (cornerRadiusPx > 0f) {
        (cornerRadiusPx - edgeThicknessPx).coerceAtLeast(targetInnerCorner)
      } else {
        0f
      }

    baseShader = LinearGradient(
      0f,
      0f,
      width,
      height,
      intArrayOf(
        Color.parseColor("#20C96F"),
        Color.parseColor("#30D987"),
        Color.parseColor("#4BE39C"),
        Color.parseColor("#1EB864"),
      ),
      floatArrayOf(0f, 0.34f, 0.67f, 1f),
      Shader.TileMode.CLAMP,
    )
  }

  override fun draw(canvas: Canvas) {
    val baseAlpha = (pulseProgress * 190f).toInt().coerceIn(0, 255)
    if (baseAlpha <= 0) return
    basePaint.shader = baseShader
    val bands = 8
    val step = edgeThicknessPx / bands
    for (i in 0 until bands) {
      val outerInset = i * step
      val innerInset = (i + 1) * step
      val bandOuterRect = RectF(
        outerRect.left + outerInset,
        outerRect.top + outerInset,
        outerRect.right - outerInset,
        outerRect.bottom - outerInset,
      )
      val bandInnerRect = RectF(
        outerRect.left + innerInset,
        outerRect.top + innerInset,
        outerRect.right - innerInset,
        outerRect.bottom - innerInset,
      )

      val t = (i + 1).toFloat() / bands.toFloat()
      val falloff = (1f - t).coerceAtLeast(0f)
      val alpha = (baseAlpha * Math.pow(falloff.toDouble(), 1.35)).toInt().coerceIn(0, 255)
      if (alpha <= 0) continue

      val bandOuterCorner =
        if (cornerRadiusPx > 0f) (cornerRadiusPx - outerInset).coerceAtLeast(innerCornerPx) else 0f
      val bandInnerCorner =
        if (cornerRadiusPx > 0f) (cornerRadiusPx - innerInset).coerceAtLeast(innerCornerPx) else 0f

      ringPath.reset()
      ringPath.fillType = Path.FillType.EVEN_ODD
      ringPath.addRoundRect(
        bandOuterRect,
        bandOuterCorner,
        bandOuterCorner,
        Path.Direction.CW,
      )
      ringPath.addRoundRect(
        bandInnerRect,
        bandInnerCorner,
        bandInnerCorner,
        Path.Direction.CW,
      )
      basePaint.alpha = alpha
      canvas.drawPath(ringPath, basePaint)
    }
  }

  override fun setAlpha(alpha: Int) {
    // Driven by setPulseProgress.
  }

  @Deprecated("Deprecated in Drawable; retained for compatibility override.")
  override fun setColorFilter(colorFilter: ColorFilter?) {
    // Not used.
  }

  override fun getOpacity(): Int = android.graphics.PixelFormat.TRANSLUCENT
}
