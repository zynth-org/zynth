package com.zynth.kit.runtime

import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import com.zynth.kit.BuildConfig
import java.util.concurrent.CountDownLatch
import org.json.JSONArray
import org.json.JSONObject

class HermesAdapter(
  private val bridge: JSBridge = JSBridge,
) : JSRuntimeAdapter {
  override var onException: ((JsRuntimeException) -> Unit)? = null

  private val jsThread = HandlerThread(THREAD_NAME).apply { start() }
  private val jsHandler = Handler(jsThread.looper)
  private val TAG = "HermesAdapter"
  @Volatile private var runtimePtr: Long = 0L
  private val timerShim = JSBridge.HandlerTimerShim(::getRuntimePtr, jsThread.looper)
  private val objects = HashMap<String, Any>()
  private val functions = HashMap<String, (Array<Any?>) -> Any?>()
  private val errorHandler = object : JSBridge.ErrorHandler {
    override fun report(message: String?, stack: String?) {
      val text = message?.takeUnless { it.isBlank() } ?: "Unknown JavaScript error"
      // Report to unified diagnostics system (this handles RedBox display)
      com.zynth.kit.dev.ZynthDiagnostics.report("hermes", text, stack)
      // Also call the legacy error handler for compatibility
      onException?.invoke(JsRuntimeException(text, stack))
    }
  }

  @Volatile private var destroyed = false

  private val nativeDebugEnabled: Boolean by lazy {
    try {
      true
      // @Suppress("USELESS_CAST")
      // (callGlobal("globalThis.__NATIVE_DEBUG__", emptyArray()) as? Boolean) ?: false
    } catch (e: Throwable) {
      false
    }
  }

  init {
    runtimePtr = runOnJS { bridge.createHermesRuntime() }
  }

  fun installBindings(
    uiShim: JSBridge.UIShim,
    modulesShim: JSBridge.ModulesShim,
  ) {
    runOnJS {
      ensureRuntime()
      bridge.installBindings(runtimePtr, uiShim, modulesShim, timerShim, errorHandler)
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

  fun emitEvent(name: String, body: Any?) {
    if (destroyed || runtimePtr == 0L) return
    val trimmedName = name.trim()
    if (trimmedName.isEmpty()) return

    val payloadJson = body?.let { encodePayload(it) }
    jsHandler.post {
      if (destroyed || runtimePtr == 0L) return@post
      try {
        ensureRuntime()
        bridge.emitEvent(runtimePtr, trimmedName, payloadJson)
      } catch (t: Throwable) {
        if (nativeDebugEnabled) Log.e(TAG, "emitEvent($trimmedName) failed", t)
        onException?.invoke(t.toJsRuntimeException())
      }
    }
  }

  fun prefersHermesBytecode(): Boolean {
    val override = System.getProperty("ZYNTH_USE_HBC")?.trim()?.lowercase()
    if (!override.isNullOrBlank()) {
      return override == "1" || override == "true" || override == "yes" || override == "on"
    }
    return BuildConfig.ZYNTH_USE_HBC
  }

  fun loadMainBundle(assets: android.content.res.AssetManager) {
    // Prefer HBC when enabled; fall back to JS source if missing or invalid.
    val useHbc = prefersHermesBytecode()

    if (useHbc) {
      try {
        // Try to load main.hbc first
        val hbcBytes = assets.open("main.hbc").use { it.readBytes() }
        if (nativeDebugEnabled) Log.d(TAG, "Loading Hermes bytecode (main.hbc)")
        evaluateBytecode(hbcBytes, "main.hbc")
        return
      } catch (e: Exception) {
        if (nativeDebugEnabled) Log.w(TAG, "Failed to load main.hbc, falling back to main.js: ${e.message}")
      }
    }

    // Fallback to JavaScript source
    try {
      val jsCode = assets.open("main.js").use { it.bufferedReader().readText() }
      if (nativeDebugEnabled) Log.d(TAG, "Loading JavaScript source (main.js)")
      evaluateSource(jsCode, "main.js")
    } catch (e: Exception) {
      Log.e(TAG, "Failed to load main.js", e)
      throw RuntimeException("Could not load JavaScript bundle", e)
    }
  }

  fun destroy() {
    if (destroyed) return
    destroyed = true
    
    // cleanup on JS thread without blocking the caller
    jsHandler.post {
      if (runtimePtr != 0L) {
        bridge.destroyHermesRuntime(runtimePtr)
        runtimePtr = 0L
      }
      timerShim.shutdown()
      
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
        jsThread.quitSafely()
      } else {
        jsThread.quit()
      }
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
    if (destroyed || runtimePtr == 0L) return
    jsHandler.post {
      try {
        ensureRuntime()
        bridge.invokeHandler(runtimePtr, handlerId, nodeId, event)
      } catch (t: Throwable) {
        if (nativeDebugEnabled) Log.e(TAG, "invokeHandler($event) failed", t)
        onException?.invoke(t.toJsRuntimeException())
      }
    }
  }

  override fun setGlobalObject(name: String, value: Any) {
    objects[name] = value
    if (nativeDebugEnabled) Log.d(TAG, "setGlobalObject($name)")
  }

  override fun setGlobalFunction(name: String, fn: (Array<Any?>) -> Any?) {
    functions[name] = fn
    if (nativeDebugEnabled) Log.d(TAG, "setGlobalFunction($name)")
  }

  override fun evaluate(code: String) {
    if (destroyed || runtimePtr == 0L) {
      Log.w(TAG, "evaluate called after runtime destroyed")
      return
    }
    evaluateSource(code)
  }

  override fun evaluateAsync(code: String) {
    if (destroyed || runtimePtr == 0L) {
      Log.w(TAG, "evaluateAsync called after runtime destroyed")
      return
    }
    jsHandler.post {
      try {
        ensureRuntime()
        evaluateSource(code)
      } catch (t: Throwable) {
        if (nativeDebugEnabled) {
          Log.e(TAG, "evaluateAsync failed", t)
        }
        onException?.invoke(t.toJsRuntimeException())
      }
    }
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

  override fun callGlobalAsync(name: String, args: Array<Any?>) {
    if (destroyed || runtimePtr == 0L) return
    val payload = args.copyOf()
    jsHandler.post {
      try {
        ensureRuntime()
        // Avoid blocking the UI thread by executing the call entirely on the JS thread.
        bridge.callGlobal(runtimePtr, name, payload)
      } catch (t: Throwable) {
        if (nativeDebugEnabled) Log.e(TAG, "callGlobalAsync($name) failed", t)
        onException?.invoke(t.toJsRuntimeException())
      }
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

  private fun Throwable.toJsRuntimeException(): JsRuntimeException {
    val text = message ?: toString()
    return JsRuntimeException(text, stackTraceToString())
  }

  private fun encodePayload(value: Any?): String? {
    if (value == null) return null
    return when (value) {
      is String -> value
      is Map<*, *> -> JSONObject(value).toString()
      is List<*> -> JSONArray(value).toString()
      is Array<*> -> JSONArray(value).toString()
      is Number, is Boolean -> JSONObject.wrap(value)?.toString() ?: value.toString()
      else -> JSONObject.wrap(value)?.toString() ?: value.toString()
    }
  }

  companion object {
    private const val TAG = "HermesAdapter"
    private const val THREAD_NAME = "ZynthHermesJS"
    private const val DEFAULT_SOURCE = "<zynth>"
  }
}
