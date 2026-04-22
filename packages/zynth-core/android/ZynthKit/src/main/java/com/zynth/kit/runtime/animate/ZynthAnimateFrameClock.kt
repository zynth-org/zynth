package com.zynth.kit.runtime.animate

import android.util.LongSparseArray
import android.view.Choreographer

internal object ZynthAnimateFrameClock {
  private val choreographer = Choreographer.getInstance()
  private val callbacks = LongSparseArray<Choreographer.FrameCallback>()

  init {
    nativeInstall(ZynthAnimateFrameClock::class.java)
  }

  @JvmStatic
  fun requestFrame(handle: Long) {
    if (callbacks.get(handle) != null) return
    val callback = Choreographer.FrameCallback { frameTimeNanos ->
      callbacks.remove(handle)
      nativeOnFrame(handle, frameTimeNanos / 1_000_000.0)
    }
    callbacks.put(handle, callback)
    choreographer.postFrameCallback(callback)
  }

  @JvmStatic
  fun cancelFrame(handle: Long) {
    val callback = callbacks.get(handle) ?: return
    callbacks.remove(handle)
    choreographer.removeFrameCallback(callback)
  }

  @JvmStatic
  private external fun nativeInstall(clazz: Class<*>)

  @JvmStatic
  private external fun nativeOnFrame(handle: Long, timeMs: Double)
}
