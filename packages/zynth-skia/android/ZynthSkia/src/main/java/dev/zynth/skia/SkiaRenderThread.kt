package dev.zynth.skia

import android.graphics.Color
import android.os.Handler
import android.os.HandlerThread
import android.view.Choreographer
import android.view.Surface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

internal class SkiaRenderThread {
  private val thread = HandlerThread("ZynthSkiaRender").apply { start() }
  private val handler = Handler(thread.looper)

  private var choreographer: Choreographer? = null
  private var frameScheduled = false

  private var nodeId: Int = -1
  private var width: Int = 0
  private var height: Int = 0
  private var clearColor: Int = Color.TRANSPARENT
  private var density: Float = 1f
  private var frameLoopEnabled: Boolean = false
  private var nativeSurfaceAvailable: Boolean = false
  private var surface: Surface? = null
  private var dirty: Boolean = false
  private var stopped: Boolean = false
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

  fun setRenderSurface(nextSurface: Surface?, w: Int, h: Int, nextDensity: Float) {
    handler.post {
      surface = nextSurface
      width = w
      height = h
      density = nextDensity
      dirty = true
      scheduleFrameLocked()
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
      surface = null
    }
    thread.quitSafely()
  }

  private fun renderOnce() {
    val target = surface ?: return
    if (!nativeSurfaceAvailable || nodeId <= 0 || width <= 0 || height <= 0) return

    SkiaBridge.renderToSurface(
      nodeId = nodeId,
      width = width,
      height = height,
      clearColor = clearColor,
      density = density,
      surface = target,
    )
  }

  private fun onFrame() {
    if (stopped) return

    val shouldRender = dirty || frameLoopEnabled
    if (shouldRender) {
      dirty = false
      renderOnce()
    }

    if (frameLoopEnabled || dirty) {
      scheduleFrameLocked()
    }
  }

  private fun scheduleFrameLocked() {
    if (stopped || frameScheduled) return
    val hasSurface = surface != null
    if (!hasSurface || nodeId <= 0 || width <= 0 || height <= 0) return
    if (!dirty && !frameLoopEnabled) return

    frameScheduled = true
    val ch = choreographer
    if (ch != null) {
      ch.postFrameCallback(frameCallback)
      return
    }
    handler.postDelayed(fallbackFrameRunnable, 16L)
  }
}
