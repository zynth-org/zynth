package dev.zynth.skia

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.util.AttributeSet
import android.view.View
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject

class SkiaView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : View(context, attrs), SkiaRenderThread.Listener {
  private var manager: ZynthUIManager? = null
  private var nodeId: Int = -1
  private var clearColor: Int = Color.TRANSPARENT
  private var frameLoopEnabled: Boolean = false
  private var surfaceAvailable: Boolean = false

  private var latestBitmap: Bitmap? = null
  private var latestWidth: Int = 0
  private var latestHeight: Int = 0
  private val drawDestRect = Rect()

  private val renderer = SkiaRenderThread()

  init {
    setWillNotDraw(false)
    clipToOutline = true
  }

  fun bind(manager: ZynthUIManager, nodeId: Int) {
    this.manager = manager
    this.nodeId = nodeId

    renderer.setListener(this)
    renderer.setViewAttached(isAttachedToWindow)
    renderer.setNodeId(nodeId)
    renderer.setClearColor(clearColor)
    renderer.setFrameLoopEnabled(frameLoopEnabled)

    setSurfaceAvailable(SkiaBridge.hasSurface(nodeId))

    val w = width.coerceAtLeast(1)
    val h = height.coerceAtLeast(1)
    renderer.updateSize(w, h, resources.displayMetrics.density)
  }

  fun setClearColor(color: Int) {
    clearColor = color
    renderer.setClearColor(color)
    markSurfaceDirty()
  }

  fun setFrameLoopEnabled(enabled: Boolean) {
    frameLoopEnabled = enabled
    renderer.setFrameLoopEnabled(enabled)
  }

  fun setAllowFallback(@Suppress("UNUSED_PARAMETER") allow: Boolean) {
    // Software-backed View path is now the default Android renderer.
  }

  fun setSurfaceAvailable(available: Boolean) {
    surfaceAvailable = available
    renderer.setNativeSurfaceAvailable(available)
    if (available) {
      markSurfaceDirty()
    }
  }

  fun markSurfaceDirty() {
    if (!surfaceAvailable) return
    renderer.markDirty()
  }

  fun emitNativeReady() {
    val payload = JSONObject().put("available", surfaceAvailable)
    manager?.dispatchEvent(nodeId, "onNativeReady", payload)
  }

  fun reset() {
    surfaceAvailable = false
    frameLoopEnabled = false
    clearColor = Color.TRANSPARENT

    renderer.setFrameLoopEnabled(false)
    renderer.setNativeSurfaceAvailable(false)
    renderer.setClearColor(clearColor)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    renderer.setViewAttached(true)
    if (width > 0 && height > 0) {
      renderer.updateSize(width, height, resources.displayMetrics.density)
      markSurfaceDirty()
    }
  }

  override fun onDetachedFromWindow() {
    renderer.setViewAttached(false)
    renderer.setListener(null)
    renderer.shutdown()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    renderer.updateSize(w.coerceAtLeast(1), h.coerceAtLeast(1), resources.displayMetrics.density)
    markSurfaceDirty()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val bitmap = latestBitmap ?: return
    if (bitmap.isRecycled) {
      latestBitmap = null
      return
    }
    if (latestWidth <= 0 || latestHeight <= 0) return

    if (width == latestWidth && height == latestHeight) {
      canvas.drawBitmap(bitmap, 0f, 0f, null)
      return
    }

    drawDestRect.set(0, 0, width, height)
    canvas.drawBitmap(bitmap, null, drawDestRect, null)
  }

  override fun onFrameReady(bitmap: Bitmap, width: Int, height: Int) {
    if (bitmap.isRecycled) return
    latestBitmap = bitmap
    latestWidth = width
    latestHeight = height
    postInvalidateOnAnimation()
  }
}
