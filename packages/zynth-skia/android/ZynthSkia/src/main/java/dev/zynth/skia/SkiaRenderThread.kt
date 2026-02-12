package dev.zynth.skia

import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.HandlerThread
import android.view.Choreographer
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

internal class SkiaRenderThread {
  interface Listener {
    fun onFrameReady(bitmap: Bitmap, width: Int, height: Int)
  }

  private val thread = HandlerThread("ZynthSkiaRender").apply { start() }
  private val handler = Handler(thread.looper)
  private val mainHandler = Handler(android.os.Looper.getMainLooper())

  private var choreographer: Choreographer? = null
  private var frameScheduled = false

  private var listenerRef: WeakReference<Listener>? = null

  private var nodeId: Int = -1
  private var width: Int = 0
  private var height: Int = 0
  private var clearColor: Int = Color.TRANSPARENT
  private var density: Float = 1f
  private var frameLoopEnabled: Boolean = false
  private var nativeSurfaceAvailable: Boolean = false
  private var viewAttached: Boolean = false
  private var dirty: Boolean = false
  private var stopped: Boolean = false

  private var bitmapA: Bitmap? = null
  private var bitmapB: Bitmap? = null
  private var displayedBitmap: Bitmap? = null
  private val pendingDeliveryBitmaps = HashSet<Bitmap>()

  private val fallbackFrameRunnable = Runnable {
    frameScheduled = false
    onFrame()
  }

  private val frameCallback = Choreographer.FrameCallback {
    frameScheduled = false
    onFrame()
  }

  init {
    val latch = CountDownLatch(1)
    handler.post {
      choreographer = Choreographer.getInstance()
      latch.countDown()
    }
    latch.await(500, TimeUnit.MILLISECONDS)
  }

  fun setListener(listener: Listener?) {
    handler.post {
      listenerRef = if (listener == null) null else WeakReference(listener)
    }
  }

  fun setViewAttached(value: Boolean) {
    handler.post {
      viewAttached = value
      if (!value) {
        dirty = false
      } else {
        dirty = true
        scheduleFrameLocked()
      }
    }
  }

  fun setNodeId(value: Int) {
    handler.post {
      nodeId = value
      dirty = true
      scheduleFrameLocked()
    }
  }

  fun setClearColor(value: Int) {
    handler.post {
      clearColor = value
      dirty = true
      scheduleFrameLocked()
    }
  }

  fun setFrameLoopEnabled(value: Boolean) {
    handler.post {
      frameLoopEnabled = value
      if (value) {
        dirty = true
      }
      scheduleFrameLocked()
    }
  }

  fun setNativeSurfaceAvailable(value: Boolean) {
    handler.post {
      nativeSurfaceAvailable = value
      if (!value) {
        dirty = false
      } else {
        dirty = true
        scheduleFrameLocked()
      }
    }
  }

  fun updateSize(w: Int, h: Int, nextDensity: Float) {
    handler.post {
      width = w
      height = h
      density = nextDensity
      dirty = true
      scheduleFrameLocked()
    }
  }

  fun markDirty() {
    handler.post {
      dirty = true
      scheduleFrameLocked()
    }
  }

  fun shutdown() {
    handler.post {
      stopped = true
      if (frameScheduled) {
        choreographer?.removeFrameCallback(frameCallback)
        handler.removeCallbacks(fallbackFrameRunnable)
        frameScheduled = false
      }
      listenerRef = null
      releaseBitmaps()
    }
    thread.quitSafely()
  }

  private fun renderOnce(): Boolean {
    if (!viewAttached || !nativeSurfaceAvailable || nodeId <= 0 || width <= 0 || height <= 0) return false

    val targetBitmap = obtainRenderBitmap(width, height) ?: return false

    val rendered = SkiaBridge.renderToBitmap(
      nodeId = nodeId,
      width = width,
      height = height,
      clearColor = clearColor,
      density = density,
      bitmap = targetBitmap,
    )
    if (!rendered) return false

    pendingDeliveryBitmaps.add(targetBitmap)
    val listener = listenerRef?.get()
    if (listener != null) {
      val frameWidth = width
      val frameHeight = height
      mainHandler.post {
        listenerRef?.get()?.onFrameReady(targetBitmap, frameWidth, frameHeight)
        handler.post {
          pendingDeliveryBitmaps.remove(targetBitmap)
          displayedBitmap = targetBitmap
        }
      }
    } else {
      pendingDeliveryBitmaps.remove(targetBitmap)
      displayedBitmap = targetBitmap
    }

    return true
  }

  private fun onFrame() {
    if (stopped) return

    val shouldRender = dirty || frameLoopEnabled
    if (shouldRender) {
      dirty = false
      val drew = renderOnce()
      if (!drew) {
        dirty = true
      }
    }

    if (frameLoopEnabled || dirty) {
      scheduleFrameLocked()
    }
  }

  private fun scheduleFrameLocked() {
    if (stopped || frameScheduled) return
    if (nodeId <= 0 || width <= 0 || height <= 0) return
    if (!dirty && !frameLoopEnabled) return

    frameScheduled = true
    val ch = choreographer
    if (ch != null) {
      ch.postFrameCallback(frameCallback)
      return
    }
    handler.postDelayed(fallbackFrameRunnable, 16L)
  }

  private fun obtainRenderBitmap(nextWidth: Int, nextHeight: Int): Bitmap? {
    if (nextWidth <= 0 || nextHeight <= 0) return null

    bitmapA = ensureBitmapSize(bitmapA, nextWidth, nextHeight)
    bitmapB = ensureBitmapSize(bitmapB, nextWidth, nextHeight)

    val a = bitmapA
    val b = bitmapB
    if (a == null && b == null) return null

    fun canRenderTo(bitmap: Bitmap?): Boolean {
      if (bitmap == null || bitmap.isRecycled) return false
      if (bitmap === displayedBitmap) return false
      if (pendingDeliveryBitmaps.contains(bitmap)) return false
      return true
    }

    val canUseA = canRenderTo(a)
    val canUseB = canRenderTo(b)

    if (canUseA && canUseB) {
      return if (displayedBitmap === a) b else a
    }
    if (canUseA) return a
    if (canUseB) return b
    return null
  }

  private fun ensureBitmapSize(bitmap: Bitmap?, width: Int, height: Int): Bitmap? {
    if (bitmap != null && !bitmap.isRecycled && bitmap.width == width && bitmap.height == height) {
      return bitmap
    }
    return runCatching { Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888) }.getOrNull()
  }

  private fun releaseBitmaps() {
    bitmapA = null
    bitmapB = null
    displayedBitmap = null
    pendingDeliveryBitmaps.clear()
  }
}
