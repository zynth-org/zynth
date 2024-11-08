package com.rune.kit.runtime

import android.os.Handler
import android.os.Looper
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
  )
  external fun evaluateString(runtimePtr: Long, script: String, sourceUrl: String = "<unknown>")
  external fun evaluateBytecode(runtimePtr: Long, bytecode: ByteArray, sourceUrl: String)
  external fun callGlobal(runtimePtr: Long, name: String, args: Array<Any?> = emptyArray()): Any?
  external fun onTimerFired(runtimePtr: Long, timerId: Int)
  external fun resolvePromise(runtimePtr: Long, promiseId: Int, payloadJson: String?)
  external fun rejectPromise(runtimePtr: Long, promiseId: Int, errorMessage: String?)
  external fun invokeHandler(runtimePtr: Long, handlerId: Long, nodeId: Int, event: String)

  interface UIShim {
    fun createNode(type: String): Int
    fun setProp(nodeId: Int, name: String, jsonValue: String?)
    fun setText(nodeId: Int, text: String)
    fun insertChild(parentId: Int, childId: Int, index: Int)
    fun removeChild(parentId: Int, childId: Int)
    fun removeNode(nodeId: Int)
    fun setHandler(nodeId: Int, event: String, handlerId: Long)
    fun flush()
  }

  interface ModulesShim {
    fun invoke(module: String, method: String, args: Array<Any?>, promiseId: Int)
  }

  interface TimerShim {
    fun scheduleTimeout(timerId: Int, delayMs: Long)
    fun clearTimeout(timerId: Int)
  }

  class HandlerTimerShim(
    private val runtimePtrProvider: () -> Long,
    looper: Looper,
  ) : TimerShim {
    private val handler = Handler(looper)
    private val callbacks = ConcurrentHashMap<Int, Runnable>()

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

    fun shutdown() {
      callbacks.values.forEach { handler.removeCallbacks(it) }
      callbacks.clear()
    }
  }
}
