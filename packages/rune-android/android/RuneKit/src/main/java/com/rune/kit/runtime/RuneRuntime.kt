package com.rune.kit.runtime

import android.content.Context
import android.content.res.AssetManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.soloader.SoLoader
import com.rune.kit.core.RuneRootView
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.YogaLayoutEngine
import com.rune.kit.dev.RuneDevClient
import com.rune.kit.dev.RuneDevBundle
import com.rune.kit.dev.RuneDevBundleFetcher
import java.util.LinkedHashMap
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import kotlin.jvm.Volatile
import org.mozilla.javascript.Function

private const val TAG = "RuneRuntime"

class RuneRuntime(
  internal val root: RuneRootView,  // internal for dev extension access
  internal var adapter: JSRuntimeAdapter = HermesAdapter(),  // internal for dev extension access
) {
  // Core runtime properties
  private val handlerMap = mutableMapOf<Pair<Int, String>, HandlerRef>()
  private val registry = RuneModuleRegistry()
  private val moduleExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "RuneModuleInvoker").apply { isDaemon = true }
  }
  private val installedModules = LinkedHashMap<String, RuneModule>()
  internal var lastRootId: Int? = null  // internal for dev extension access
  
  // Core UI manager
  internal val manager = RuneUIManager(  // internal for dev extension access
    root,
    YogaLayoutEngine(root.rootId),
    eventDispatcher = { id, name -> dispatchHandler(id, name) },
    handlerListener = { id, name, handlerRef -> onHandlerAttached(id, name, handlerRef) },
  )

  private fun isNativeDebugEnabled(): Boolean {
    return try {
      val debugValue = System.getProperty("__NATIVE_DEBUG__")
      debugValue?.toBoolean() ?: false
    } catch (e: Exception) {
      false
    }
  }

  private fun logDebug(tag: String, message: String) {
    if (!isNativeDebugEnabled()) return
    Log.d(tag, message)
  }

  private fun configureAdapter() {
    adapter.onException = { error ->
      val stack = error.stack?.takeIf { it.isNotBlank() }
      if (stack != null) {
        Log.e(TAG, "JS error: ${error.message}\n$stack")
      } else {
        Log.e(TAG, "JS error: ${error.message}")
      }
      root.showRedBox(error.message, error.stack)
    }

    installConsole()
    when (val runtimeAdapter = adapter) {
      is RhinoAdapter -> {
        installRhinoGlobals(runtimeAdapter)
        installRhinoBridge(runtimeAdapter)
      }
      is HermesAdapter -> installHermesBindings(runtimeAdapter)
      else -> installFallbackBridge()
    }

    injectModuleConstants()
    installHmrShim()  // Calls debug extension in DEBUG, no-op in RELEASE
  }

  init {
    configureAdapter()
    configureDevServer()  // Calls debug extension in DEBUG, no-op in RELEASE
  }

  fun installModules(modules: List<RuneModule>) {
    modules.forEach { module ->
      installedModules[module.name] = module
      registry.register(module)
    }
    injectModuleConstants()
  }

  fun load(code: String) {
    root.hideRedBox()
    adapter.evaluate(code)
  }

  /**
   * Reload JavaScript code with full runtime reset.
   * 
   * This method performs a complete runtime reset before evaluating new code:
   * - Clears all UI nodes and event handlers
   * - Destroys and recreates the JavaScript runtime adapter
   * - Reinitializes all registered native modules
   * - Reconfigures adapter with console, bridge, and HMR shim
   * - Restores dev server URL if set
   * 
   * This is the recommended way to reload JavaScript during development, ensuring
   * a clean slate without memory leaks or stale state.
   * 
   * @param code The JavaScript bundle code to evaluate after reset
   */
  fun reloadJavaScript(code: String) {
    logDebug(TAG, "Reloading JavaScript with full runtime reset")
    
    // Clear UI state
    synchronized(handlerMap) {
      handlerMap.clear()
    }
    manager.clearAllNodes()
    
    // Reset module registry
    registry.destroy()
    
    // Recreate runtime adapter
    val previousAdapter = adapter
    if (previousAdapter is HermesAdapter) {
      previousAdapter.destroy()
    }
    adapter = when (previousAdapter) {
      is RhinoAdapter -> RhinoAdapter()
      else -> HermesAdapter()
    }
    
    // Reconfigure adapter with all bindings
    configureAdapter()
    
    // Reinitialize modules
    reinitializeModules()
    
    // Dev extension will restore dev server URL if needed
    restoreDevServerUrl()
    
    // Load new code
    load(code)
  }

  fun loadInitialBundle(assets: AssetManager, assetName: String = "main.js") {
    // Try to load dev bundle first if available (extension method)
    if (loadDevBundleIfAvailable()) {
      // Dev bundle loaded successfully, start() will be called by restartAfterReload
      return
    }

    // No dev bundle available, load from assets
    val code = assets.open(assetName).use { it.bufferedReader().readText() }
    load(code)
  }

  fun start(rootId: Int) {
    lastRootId = rootId
    
    // If we're still loading the dev bundle, defer the start
    if (devServerUrl != null && !hasSuccessfulDevBundle && lastDevBundle == null) {
      logDebug(TAG, "Deferring start until dev bundle loads")
      return
    }
    
    logDebug(TAG, "Starting app with rootId=$rootId")
    adapter.callGlobalAsync("__startApp", arrayOf(rootId))
  }

  fun emitEvent(name: String, payload: Any?) {
    when (val runtimeAdapter = adapter) {
      is HermesAdapter -> runtimeAdapter.emitEvent(name, payload)
      else -> runtimeAdapter.callGlobalAsync("RuneNativeEmitter.emit", arrayOf(name, payload))
    }
  }

  fun destroy() {
    registry.destroy()
    moduleExecutor.shutdownNow()
    disconnectDevServer()  // Calls debug extension in DEBUG, no-op in RELEASE
    (adapter as? HermesAdapter)?.destroy()
    installedModules.clear()
  }

  // Public methods that delegate to debug extension (or no-op in release)
  fun connectDevServer(url: String, token: String? = null) = connectDevServerInternal(url, token)
  fun refreshDevBundle() = refreshDevBundleInternal()
  internal fun handleDevMessage(payload: String) = handleDevMessageInternal(payload)

  private fun installConsole() {
    val runtimeAdapter = adapter
    if (runtimeAdapter is HermesAdapter) {
      // Hermes bridge installs console functions natively; still ensure aliases exist.
      ensureCommonGlobalAliases(runtimeAdapter)
      return
    }
    runtimeAdapter.setGlobalFunction("console_log") { args ->
      val message = args.joinToString(" ") { it?.toString() ?: "null" }
      Log.i("JS_LOG", message)
      println("JS: $message") // Also print to stdout for easier debugging
      null
    }
    runtimeAdapter.setGlobalFunction("console_error") { args ->
      val message = args.joinToString(" ") { it?.toString() ?: "null" }
      Log.e("JS_ERROR", message)
      println("JS ERROR: $message")
      null
    }
    runtimeAdapter.setGlobalFunction("console_warn") { args ->
      val message = args.joinToString(" ") { it?.toString() ?: "null" }
      Log.w("JS_WARN", message)
      println("JS WARN: $message")
      null
    }
    runtimeAdapter.evaluate("""
      globalThis.console = globalThis.console || {};
      globalThis.console.log = console_log;
      globalThis.console.error = console_error;
      globalThis.console.warn = console_warn;
    """)

    ensureCommonGlobalAliases(runtimeAdapter)
  }

  private fun ensureCommonGlobalAliases(runtimeAdapter: JSRuntimeAdapter) {
    runtimeAdapter.evaluate(
      """
      if (typeof globalThis.global === 'undefined') {
        globalThis.global = globalThis;
      }
      if (typeof globalThis.self === 'undefined') {
        globalThis.self = globalThis;
      }
      if (typeof globalThis.window === 'undefined') {
        globalThis.window = globalThis;
      }
      """
    )
  }

  private fun injectModuleConstants() {
    val constants = registry.exportedConstants()
    if (constants.isEmpty()) {
      adapter.evaluate("globalThis.NativeConstants = globalThis.NativeConstants || {};")
      return
    }
    val json = JSONObject()
    for ((key, value) in constants) {
      json.put(key, wrapForJson(value))
    }
    adapter.evaluate("globalThis.NativeConstants = ${json.toString()};")
  }

  private fun reinitializeModules() {
    if (installedModules.isEmpty()) {
      return
    }
    installedModules.values.forEach { module ->
      registry.register(module)
    }
    injectModuleConstants()
  }

  private fun installRhinoGlobals(rhino: RhinoAdapter) {
    // Install proper setTimeout/clearTimeout implementation
    val timeouts = mutableMapOf<Int, android.os.Handler?>()
    var nextTimeoutId = 1
    
    adapter.setGlobalFunction("setTimeout") { args ->
      val fn = args.getOrNull(0) as? org.mozilla.javascript.Function
      val delay = (args.getOrNull(1) as? Number)?.toLong() ?: 0L
      if (fn != null) {
        val timeoutId = nextTimeoutId++
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        timeouts[timeoutId] = handler
        handler.postDelayed({
          timeouts.remove(timeoutId)
          try {
            rhino.callFunction(fn, arrayOf())
          } catch (e: Exception) {
            Log.e("JS", "setTimeout error: ${e.message}")
          }
        }, delay)
        timeoutId
      } else 0
    }
    
    adapter.setGlobalFunction("clearTimeout") { args ->
      val timeoutId = (args.getOrNull(0) as? Number)?.toInt()
      timeoutId?.let { id ->
        timeouts.remove(id)?.removeCallbacksAndMessages(null)
      }
      null
    }
    
    rhino.evaluate(
      """
      if (typeof globalThis.setTimeout !== "function") {
        globalThis.setTimeout = setTimeout;
      }
      if (typeof globalThis.clearTimeout !== "function") {
        globalThis.clearTimeout = clearTimeout;
      }
      if (typeof globalThis.Promise !== "function") {
        (function() {
          function SimplePromise(executor) {
            if (!(this instanceof SimplePromise)) return new SimplePromise(executor);
            var self = this;
            self._resolved = false;
            self._value = undefined;
            self._handlers = [];
            function resolve(value) {
              if (self._resolved) return;
              self._resolved = true;
              self._value = value;
              var handlers = self._handlers.slice();
              self._handlers.length = 0;
              for (var i = 0; i < handlers.length; i++) {
                try { handlers[i](value); } catch (e) {}
              }
            }
            function reject(err) {
              resolve(err);
            }
            try {
              executor(resolve, reject);
            } catch (e) {
              reject(e);
            }
          }
          SimplePromise.prototype.then = function(onFulfilled) {
            if (typeof onFulfilled !== "function") return this;
            if (this._resolved) {
              try { onFulfilled(this._value); } catch (e) {}
            } else {
              this._handlers.push(onFulfilled);
            }
            return this;
          };
          SimplePromise.prototype.catch = function() {
            return this;
          };
          SimplePromise.resolve = function(value) {
            return new SimplePromise(function(resolve) { resolve(value); });
          };
          globalThis.Promise = SimplePromise;
        })();
      }
      globalThis.__RUNE_PLATFORM = "android";
    """.trimIndent(),
    )
  }

  private fun installRhinoBridge(rhino: RhinoAdapter) {
    adapter.setGlobalFunction("__ui_createNode") { args ->
      val type = args.stringAt(0) ?: "view"
      manager.createNode(type)
    }
    adapter.setGlobalFunction("__ui_setProp") { args ->
      val id = args.intAt(0) ?: return@setGlobalFunction null
      val name = args.stringAt(1) ?: return@setGlobalFunction null
      val json = args.stringAt(2) ?: "{}"
      manager.setProp(id, name, json)
      null
    }
    adapter.setGlobalFunction("__ui_setText") { args ->
      val id = args.intAt(0) ?: return@setGlobalFunction null
      val text = args.stringAt(1) ?: ""
      manager.setText(id, text)
      null
    }
    adapter.setGlobalFunction("__ui_insertChild") { args ->
      val parent = args.intAt(0) ?: return@setGlobalFunction null
      val child = args.intAt(1) ?: return@setGlobalFunction null
      val index = args.intAt(2) ?: 0
      manager.insertChild(parent, child, index)
      null
    }
    adapter.setGlobalFunction("__ui_removeChild") { args ->
      val parent = args.intAt(0) ?: return@setGlobalFunction null
      val child = args.intAt(1) ?: return@setGlobalFunction null
      manager.removeChild(parent, child)
      null
    }
    adapter.setGlobalFunction("__ui_setHandler") { args ->
      val id = args.intAt(0) ?: return@setGlobalFunction null
      val name = args.stringAt(1) ?: return@setGlobalFunction null
      val fn = args.getOrNull(2)
      logDebug("RuneUI", "Registering handler: id=$id name=$name fn=${fn?.javaClass?.simpleName}")
      if (fn is Function) {
        handlerMap[id to name] = HandlerRef.Rhino(fn)
        logDebug("RuneUI", "Handler registered in handlerMap")
      } else {
        logDebug("RuneUI", "Handler function is null or not a Function")
      }
      manager.setHandler(id, name, 0L)
      null
    }
    adapter.setGlobalFunction("__ui_flush") { _ ->
      manager.flush()
      null
    }
    adapter.evaluate(
      """
      globalThis.__ui = {
        createNode: function(type) { return __ui_createNode(type); },
        setProp: function(id, name, value) { return __ui_setProp(id, name, JSON.stringify(value == null ? {} : value)); },
        setText: function(id, text) { return __ui_setText(id, String(text == null ? "" : text)); },
        insertChild: function(parent, child, index) { return __ui_insertChild(parent, child, index == null ? 0 : index); },
        removeChild: function(parent, child) { return __ui_removeChild(parent, child); },
        setHandler: function(id, name, fn) { return __ui_setHandler(id, name, fn); },
        flush: function() { return __ui_flush(); }
      };
      """.trimIndent(),
    )

    adapter.setGlobalFunction("__modules_call") { args ->
      val name = args.stringAt(0) ?: return@setGlobalFunction mapOf("error" to "bad_args")
      val method = args.stringAt(1) ?: return@setGlobalFunction mapOf("error" to "bad_args")
      val payload = arrayOf(args.getOrNull(2))
      val result = handleModuleCall(name, method, payload)
      if (result.length() == 0) return@setGlobalFunction emptyMap<String, Any?>()
      rhino.parseJson(result.toString()) ?: emptyMap<String, Any?>()
    }
    adapter.evaluate("globalThis.__modules = { call: __modules_call };")
  }

  private fun installFallbackBridge() {
    RuneBridge.install(adapter, manager)
    adapter.setGlobalObject(
      "__modules",
      mapOf(
        "call" to call@{ argv: Array<Any?> ->
          val name = argv.firstOrNull() as? String ?: return@call mapOf("error" to "bad_args")
          val method = argv.getOrNull(1) as? String ?: return@call mapOf("error" to "bad_args")
          val args = arrayOf(argv.getOrNull(2))
          parseJson(handleModuleCall(name, method, args).toString())
        },
      ),
    )
  }

  private fun handleModuleCall(name: String, method: String, args: Array<Any?>): JSONObject {
    return registry.call(name, method, args)
  }

  private fun handleModuleCallSync(name: String, method: String, args: Array<Any?>): Any? {
    return registry.callSync(name, method, args)
  }

  private fun dispatchHandler(id: Int, name: String) {
    logDebug("RuneUI", "dispatchHandler called for id=$id name=$name")
    val key = id to name
    val handler = handlerMap[key]
    val runtimeAdapter = adapter
    logDebug("RuneUI", "Handler function found: ${handler != null}")
    when {
      handler is HandlerRef.Rhino && runtimeAdapter is RhinoAdapter -> {
        val payload = manager.consumeEventPayload(id, name)
        val eventPayload = mutableMapOf<String, Any?>("target" to id, "type" to name)
        if (payload != null) {
          eventPayload.putAll(payload.toMap())
        }
        val event = runtimeAdapter.createObject(eventPayload)
        logDebug("RuneUI", "Calling JavaScript function")
        runtimeAdapter.callFunction(handler.function, arrayOf(event))
      }
      handler is HandlerRef.Hermes && runtimeAdapter is HermesAdapter -> {
        logDebug("RuneUI", "Dispatching Hermes handler $handler for node $id")
        runtimeAdapter.invokeHandler(handler.handlerId, id, name)
      }
      else -> logDebug("RuneUI", "No valid handler found for $key")
    }
  }

  private fun installHermesBindings(hermes: HermesAdapter) {
    val uiShim = object : JSBridge.UIShim {
      override fun createNode(type: String): Int = manager.createNode(type)

      override fun setProp(nodeId: Int, name: String, jsonValue: String?) {
        manager.setProp(nodeId, name, jsonValue ?: "{}")
      }

      override fun setText(nodeId: Int, text: String) {
        manager.setText(nodeId, text)
      }

      override fun insertChild(parentId: Int, childId: Int, index: Int) {
        manager.insertChild(parentId, childId, index)
      }

      override fun removeChild(parentId: Int, childId: Int) {
        manager.removeChild(parentId, childId)
      }

      override fun removeNode(nodeId: Int) {
        clearHandlersForNode(nodeId)
        manager.removeNode(nodeId)
      }

      override fun setHandler(nodeId: Int, event: String, handlerId: Long) {
        manager.setHandler(nodeId, event, handlerId)
      }

      override fun flush() {
        manager.flush()
      }

      override fun dequeueEventPayload(nodeId: Int, event: String): String? {
        return manager.dequeueEventPayloadJson(nodeId, event)
      }
    }

    val modulesShim = HermesModulesShim(hermes)
    hermes.installBindings(uiShim, modulesShim)
  }

  private fun clearHandlersForNode(nodeId: Int) {
    val iterator = handlerMap.entries.iterator()
    while (iterator.hasNext()) {
      val entry = iterator.next()
      if (entry.key.first == nodeId) {
        iterator.remove()
      }
    }
  }

  private fun onHandlerAttached(id: Int, name: String, handlerRef: Long) {
    val key = id to name
    val runtimeAdapter = adapter
    if (runtimeAdapter is HermesAdapter) {
      if (handlerRef != 0L) {
        handlerMap[key] = HandlerRef.Hermes(handlerRef)
      } else {
        handlerMap.remove(key)
      }
    }
  }

  private inner class HermesModulesShim(
    private val hermes: HermesAdapter,
  ) : JSBridge.ModulesShim {
    override fun getConstants(): String {
      val constants = registry.exportedConstants()
      if (constants.isEmpty()) return "{}"
      val json = JSONObject()
      for ((key, value) in constants) {
        json.put(key, wrapForJson(value))
      }
      return json.toString()
    }

    override fun invoke(module: String, method: String, args: Array<Any?>, promiseId: Int) {
      logDebug(TAG, "HermesModulesShim.invoke module=$module method=$method argsCount=${args.size} promiseId=$promiseId")
      moduleExecutor.execute {
        try {
          val result = handleModuleCall(module, method, args)
          logDebug(TAG, "HermesModulesShim.resolve promiseId=$promiseId resultLen=${result.length()}")
          hermes.resolvePromise(promiseId, result.toString())
        } catch (t: Throwable) {
          Log.e(TAG, "HermesModulesShim.reject promiseId=$promiseId: ${t.message}")
          hermes.rejectPromise(promiseId, t.message ?: "error")
        }
      }
    }

    override fun callSync(module: String, method: String, args: Array<Any?>): Any? {
      logDebug(TAG, "HermesModulesShim.callSync module=$module method=$method args=${args.size}")
      return handleModuleCallSync(module, method, args)
    }
  }

  private sealed class HandlerRef {
    data class Rhino(val function: Function) : HandlerRef()
    data class Hermes(val handlerId: Long) : HandlerRef()
  }

  private fun Array<Any?>.getOrNull(index: Int): Any? = if (index in indices) this[index] else null

  private fun Array<Any?>.intAt(index: Int): Int? {
    return when (val value = getOrNull(index)) {
      is Int -> value
      is Double -> value.toInt()
      is Float -> value.toInt()
      is Long -> value.toInt()
      is Number -> value.toInt()
      is String -> value.toIntOrNull()
      else -> null
    }
  }

  private fun Array<Any?>.stringAt(index: Int): String? {
    val value = getOrNull(index) ?: return null
    return when (value) {
      is String -> value
      is CharSequence -> value.toString()
      else -> value.toString()
    }
  }

  private fun toJsonString(value: Any?): String {
    if (value == null) return "{}"
    return when (value) {
      is String -> value
      is Map<*, *> -> JSONObject(value).toString()
      is List<*> -> JSONArray(value).toString()
      is Array<*> -> JSONArray(value).toString()
      is Number, is Boolean -> JSONObject.wrap(value)?.toString() ?: value.toString()
      else -> JSONObject.wrap(value)?.toString() ?: "{}"
    }
  }

  private fun parseJson(data: String): Any {
    return try {
      when {
        data.trim().startsWith("[") -> JSONArray(data).toList()
        data.trim().startsWith("{") -> JSONObject(data).toMap()
        data.isBlank() -> emptyMap<String, Any?>()
        else -> data
      }
    } catch (t: Throwable) {
      mapOf("error" to "invalid_json")
    }
  }

  private fun JSONArray.toList(): List<Any?> {
    val list = ArrayList<Any?>(length())
    for (i in 0 until length()) {
      val value = get(i)
      list.add(
        when (value) {
          is JSONObject -> value.toMap()
          is JSONArray -> value.toList()
          JSONObject.NULL -> null
          else -> value
        },
      )
    }
    return list
  }

  private fun JSONObject.toMap(): Map<String, Any?> {
    val map = mutableMapOf<String, Any?>()
    val keys = keys()
    while (keys.hasNext()) {
      val key = keys.next()
      val value = get(key)
      map[key] = when (value) {
        is JSONObject -> value.toMap()
        is JSONArray -> value.toList()
        JSONObject.NULL -> null
        else -> value
      }
    }
    return map
  }

  private fun wrapForJson(value: Any?): Any? = when (value) {
    null -> JSONObject.NULL
    is JSONObject, is JSONArray, is Number, is Boolean, is String -> value
    is Map<*, *> -> JSONObject(value)
    is Collection<*> -> JSONArray(value)
    is Array<*> -> JSONArray(value.toList())
    else -> value.toString()
  }

  companion object {
    /**
     * Initialize SoLoader required for Yoga layout engine.
     * Call this before creating any RuneRuntime instances.
     */
    @JvmStatic
    fun initialize(context: Context) {
      SoLoader.init(context, false)
    }
  }
}
