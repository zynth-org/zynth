package com.rune.kit.runtime

import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import java.util.concurrent.ConcurrentHashMap

object JSBridge {
  init {
    System.loadLibrary("rune_kit")
  }

  external fun createHermesRuntime(): Long
  external fun destroyHermesRuntime(runtimePtr: Long)
  external fun installBindings(
    runtimePtr: Long,
    uiShim: UIShim,
    modulesShim: ModulesShim,
    timerShim: TimerShim,
    errorHandler: ErrorHandler,
  )
  external fun evaluateString(runtimePtr: Long, script: String, sourceUrl: String = "<unknown>")
  external fun evaluateBytecode(runtimePtr: Long, bytecode: ByteArray, sourceUrl: String)
  external fun callGlobal(runtimePtr: Long, name: String, args: Array<Any?> = emptyArray()): Any?
  external fun onTimerFired(runtimePtr: Long, timerId: Int)
  external fun onAnimationFrame(runtimePtr: Long, frameId: Int, frameTimeNanos: Long)
  external fun resolvePromise(runtimePtr: Long, promiseId: Int, payloadJson: String?)
  external fun rejectPromise(runtimePtr: Long, promiseId: Int, errorMessage: String?)
  external fun invokeHandler(runtimePtr: Long, handlerId: Long, nodeId: Int, event: String)
  external fun emitEvent(runtimePtr: Long, name: String, payloadJson: String?)

  interface UIShim {
    fun createNode(type: String): Int
    fun setProp(nodeId: Int, name: String, jsonValue: String?)
    fun setText(nodeId: Int, text: String)
    fun insertChild(parentId: Int, childId: Int, index: Int)
    fun removeChild(parentId: Int, childId: Int)
    fun removeNode(nodeId: Int)
    fun setHandler(nodeId: Int, event: String, handlerId: Long)
    fun flush()
    fun dequeueEventPayload(nodeId: Int, event: String): String?
  }

  interface ModulesShim {
    fun getConstants(): String
    fun invoke(module: String, method: String, args: Array<Any?>, promiseId: Int)
    fun callSync(module: String, method: String, args: Array<Any?>): Any?

    @Deprecated("Use callSync with Array<Any?> instead")
    fun callSync(module: String, method: String, argsJson: String?): String? {
      throw UnsupportedOperationException("JSON-based callSync is deprecated")
    }
  }

  interface TimerShim {
    fun scheduleTimeout(timerId: Int, delayMs: Long)
    fun clearTimeout(timerId: Int)
    fun requestAnimationFrame(frameId: Int)
    fun cancelAnimationFrame(frameId: Int)
  }

  interface ErrorHandler {
    fun report(message: String?, stack: String?)
  }

  class HandlerTimerShim(
    private val runtimePtrProvider: () -> Long,
    looper: Looper,
  ) : TimerShim {
    private val handler = Handler(looper)
    private val callbacks = ConcurrentHashMap<Int, Runnable>()
    private val frameCallbacks = ConcurrentHashMap<Int, Choreographer.FrameCallback>()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun scheduleTimeout(timerId: Int, delayMs: Long) {
      val runnable = Runnable {
        callbacks.remove(timerId)
        val runtimePtr = runtimePtrProvider()
        if (runtimePtr != 0L) {
          onTimerFired(runtimePtr, timerId)
        }
      }
      callbacks.put(timerId, runnable)?.let { handler.removeCallbacks(it) }
      handler.postDelayed(runnable, delayMs)
    }

    override fun clearTimeout(timerId: Int) {
      callbacks.remove(timerId)?.let { handler.removeCallbacks(it) }
    }

    override fun requestAnimationFrame(frameId: Int) {
      val callback = Choreographer.FrameCallback { frameTimeNanos ->
        frameCallbacks.remove(frameId)
        val runtimePtr = runtimePtrProvider()
        if (runtimePtr != 0L) {
          onAnimationFrame(runtimePtr, frameId, frameTimeNanos)
        }
      }
      frameCallbacks[frameId] = callback
      mainHandler.post {
        Choreographer.getInstance().postFrameCallback(callback)
      }
    }

    override fun cancelAnimationFrame(frameId: Int) {
      val callback = frameCallbacks.remove(frameId) ?: return
      mainHandler.post {
        Choreographer.getInstance().removeFrameCallback(callback)
      }
    }

    fun shutdown() {
      callbacks.values.forEach { handler.removeCallbacks(it) }
      callbacks.clear()
      val pendingFrames = frameCallbacks.values.toList()
      frameCallbacks.clear()
      if (pendingFrames.isNotEmpty()) {
        mainHandler.post {
          val choreographer = Choreographer.getInstance()
          pendingFrames.forEach { choreographer.removeFrameCallback(it) }
        }
      }
    }
  }
}
