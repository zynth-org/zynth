package com.rune.kit.runtime

import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import java.util.concurrent.CountDownLatch

class HermesAdapter(
  private val bridge: JSBridge = JSBridge,
) : JSRuntimeAdapter {
  override var onException: ((String) -> Unit)? = null

  private val jsThread = HandlerThread(THREAD_NAME).apply { start() }
  private val jsHandler = Handler(jsThread.looper)
  @Volatile private var runtimePtr: Long = 0L
  private val timerShim = JSBridge.HandlerTimerShim(::getRuntimePtr, jsThread.looper)
  private val objects = HashMap<String, Any>()
  private val functions = HashMap<String, (Array<Any?>) -> Any?>()

  @Volatile private var destroyed = false

  init {
    runtimePtr = runOnJS { bridge.createHermesRuntime() }
  }

  fun installBindings(
    uiShim: JSBridge.UIShim,
    modulesShim: JSBridge.ModulesShim,
  ) {
    runOnJS {
      ensureRuntime()
      bridge.installBindings(runtimePtr, uiShim, modulesShim, timerShim)
    }
  }

  fun evaluateSource(code: String, sourceUrl: String = DEFAULT_SOURCE) {
    runOnJS {
      ensureRuntime()
      bridge.evaluateString(runtimePtr, code, sourceUrl)
    }
  }

  fun evaluateBytecode(bytecode: ByteArray, sourceUrl: String) {
    runOnJS {
      ensureRuntime()
      bridge.evaluateBytecode(runtimePtr, bytecode, sourceUrl)
    }
  }

  fun destroy() {
    if (destroyed) return
    runOnJS {
      if (runtimePtr != 0L) {
        bridge.destroyHermesRuntime(runtimePtr)
        runtimePtr = 0L
      }
      timerShim.shutdown()
    }
    destroyed = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
      jsThread.quitSafely()
    } else {
      jsThread.quit()
    }
  }

  fun resolvePromise(promiseId: Int, payloadJson: String?) {
    runOnJS {
      ensureRuntime()
      bridge.resolvePromise(runtimePtr, promiseId, payloadJson)
    }
  }

  fun rejectPromise(promiseId: Int, message: String?) {
    runOnJS {
      ensureRuntime()
      bridge.rejectPromise(runtimePtr, promiseId, message)
    }
  }

  fun invokeHandler(handlerId: Long, nodeId: Int, event: String) {
    runOnJS {
      ensureRuntime()
      bridge.invokeHandler(runtimePtr, handlerId, nodeId, event)
    }
  }

  override fun setGlobalObject(name: String, value: Any) {
    objects[name] = value
    Log.d(TAG, "setGlobalObject($name)")
  }

  override fun setGlobalFunction(name: String, fn: (Array<Any?>) -> Any?) {
    functions[name] = fn
    Log.d(TAG, "setGlobalFunction($name)")
  }

  override fun evaluate(code: String) {
    if (destroyed || runtimePtr == 0L) {
      Log.w(TAG, "evaluate called after runtime destroyed")
      return
    }
    evaluateSource(code)
  }

  override fun callGlobal(name: String, args: Array<Any?>): Any? {
    return if (!destroyed && runtimePtr != 0L) {
      runOnJS {
        ensureRuntime()
        bridge.callGlobal(runtimePtr, name, args)
      }
    } else {
      functions[name]?.invoke(args)
    }
  }

  fun <T> runOnJS(block: () -> T): T {
    check(!destroyed) { "Hermes runtime already destroyed" }
    if (Looper.myLooper() == jsHandler.looper) {
      return block()
    }

    val latch = CountDownLatch(1)
    var result: Any? = null
    var failure: Throwable? = null
    jsHandler.post {
      try {
        result = block()
      } catch (t: Throwable) {
        failure = t
      } finally {
        latch.countDown()
      }
    }
    latch.await()
    failure?.let { throw it }
    @Suppress("UNCHECKED_CAST")
    return result as T
  }

  private fun ensureRuntime() {
    check(runtimePtr != 0L) { "Hermes runtime is not available" }
  }

  private fun getRuntimePtr(): Long = runtimePtr

  companion object {
    private const val TAG = "HermesAdapter"
    private const val THREAD_NAME = "RuneHermesJS"
    private const val DEFAULT_SOURCE = "<rune>"
  }
}
