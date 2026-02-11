package dev.zynth.skia

import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject

class SkiaView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : SurfaceView(context, attrs), SurfaceHolder.Callback {
  private var manager: ZynthUIManager? = null
  private var nodeId: Int = -1
  private var clearColor: Int = Color.TRANSPARENT
  private var frameLoopEnabled: Boolean = false
  private var surfaceAvailable: Boolean = false

  private val renderer = SkiaRenderThread()

  init {
    holder.addCallback(this)
  }

  fun bind(manager: ZynthUIManager, nodeId: Int) {
    this.manager = manager
    this.nodeId = nodeId
    renderer.setNodeId(nodeId)
    renderer.setClearColor(clearColor)
    renderer.setFrameLoopEnabled(frameLoopEnabled)
    setSurfaceAvailable(SkiaBridge.hasSurface(nodeId))

    val currentSurface = holder.surface
    if (currentSurface != null && currentSurface.isValid) {
      attachSurface(currentSurface, width.coerceAtLeast(1), height.coerceAtLeast(1))
    }
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
    // Surface-backed renderer path does not use Android primitive fallback.
    // keep method for prop compatibility.
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

  override fun onDetachedFromWindow() {
    detachSurface()
    renderer.shutdown()
    super.onDetachedFromWindow()
  }

  override fun surfaceCreated(holder: SurfaceHolder) {
    val surface = holder.surface
    if (surface == null || !surface.isValid) return
    renderer.setNativeSurfaceAvailable(surfaceAvailable)
    val w = if (width > 0) width else 1
    val h = if (height > 0) height else 1
    attachSurface(surface, w, h)
  }

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    renderer.updateSize(width, height, resources.displayMetrics.density)
    markSurfaceDirty()
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    renderer.setNativeSurfaceAvailable(false)
    detachSurface()
  }

  private fun attachSurface(surface: Surface, width: Int, height: Int) {
    renderer.setRenderSurface(surface, width, height, resources.displayMetrics.density)
    renderer.setNativeSurfaceAvailable(surfaceAvailable)
    markSurfaceDirty()
  }

  private fun detachSurface() {
    renderer.setNativeSurfaceAvailable(false)
    renderer.setRenderSurface(null, 0, 0, resources.displayMetrics.density)
  }
}
