package com.rune.kit.runtime

import android.content.Context
import android.content.res.AssetManager
import android.util.Log
import com.facebook.soloader.SoLoader
import com.rune.kit.core.RuneRootView
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.YogaLayoutEngine
import com.rune.kit.dev.RuneDevClient
import com.rune.kit.dev.RuneDevBundle
import com.rune.kit.dev.RuneDevBundleFetcher
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.mozilla.javascript.Function

class RuneRuntime(
  private val root: RuneRootView,
  private val adapter: JSRuntimeAdapter = HermesAdapter(),
) {
  private val handlerMap = mutableMapOf<Pair<Int, String>, HandlerRef>()
  private val registry = RuneModuleRegistry()
  private val moduleExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "RuneModuleInvoker").apply { isDaemon = true }
  }
  private val devClient = RuneDevClient(this)
  private var devServerUrl: String? = System.getenv("RUNE_DEV_SERVER_URL")?.takeUnless { it.isBlank() }
  private var lastDevBundle: RuneDevBundle? = null
  private var lastRootId: Int? = null
  private val statusBar = RuneDevStatusBar(root.context)
  private val manager = RuneUIManager(
    root,
    YogaLayoutEngine(root.rootId),
    eventDispatcher = { id, name -> dispatchHandler(id, name) },
    handlerListener = { id, name, handlerRef -> onHandlerAttached(id, name, handlerRef) },
  )

  init {
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
    when (adapter) {
      is RhinoAdapter -> {
        installRhinoGlobals(adapter)
        installRhinoBridge(adapter)
      }
      is HermesAdapter -> installHermesBindings(adapter)
      else -> installFallbackBridge()
    }
    installHmrShim()

    devServerUrl?.let {
      installDevServerGlobal(it)
      Log.d(TAG, "Connecting to dev server at $it")
      connectDevServer(it)
    }
  }

  fun installModules(modules: List<RuneModule>) {
    modules.forEach { registry.register(it) }
  }

  fun load(code: String) {
    root.hideRedBox()
    adapter.evaluate(code)
  }

  fun loadInitialBundle(assets: AssetManager, assetName: String = "main.js") {
    if (loadDevBundleIfAvailable()) {
      return
    }

    val code = assets.open(assetName).use { it.bufferedReader().readText() }
    load(code)
  }

  fun start(rootId: Int) {
    lastRootId = rootId
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
    devClient.disconnect()
    if (adapter is HermesAdapter) {
      adapter.destroy()
    }
  }

  fun connectDevServer(url: String) {
    devServerUrl = url
    installDevServerGlobal(url)
    devClient.connect(url)
  }

  internal fun handleDevMessage(payload: String) {
    // Show update notification when HMR message received
    if (payload.contains("\"type\":\"update\"") || payload.contains("'type':'update'")) {
      root.post { statusBar.showUpdateAvailable() }
    }
    adapter.callGlobal("__rune_receiveHMRMessage", arrayOf(payload))
  }

  fun refreshDevBundle() {
    Log.d(TAG, "refreshDevBundle invoked")
    root.post { statusBar.showUpdating() }
    if (loadDevBundleIfAvailable()) {
      restartAfterReload()
    }
  }

  private fun installConsole() {
    if (adapter is HermesAdapter) {
      // Hermes bridge installs console functions natively.
      return
    }
    adapter.setGlobalFunction("console_log") { args ->
      val message = args.joinToString(" ") { it?.toString() ?: "null" }
      Log.i("JS_LOG", message)
      println("JS: $message") // Also print to stdout for easier debugging
      null
    }
    adapter.setGlobalFunction("console_error") { args ->
      val message = args.joinToString(" ") { it?.toString() ?: "null" }
      Log.e("JS_ERROR", message)
      println("JS ERROR: $message")
      null
    }
    adapter.setGlobalFunction("console_warn") { args ->
      val message = args.joinToString(" ") { it?.toString() ?: "null" }
      Log.w("JS_WARN", message)
      println("JS WARN: $message")
      null
    }
    adapter.evaluate("""
      globalThis.console = globalThis.console || {};
      globalThis.console.log = console_log;
      globalThis.console.error = console_error;
      globalThis.console.warn = console_warn;
    """)
  }

  private fun installHmrShim() {
    adapter.evaluate(
      """
      if (typeof globalThis.__rune_receiveHMRMessage !== "function") {
        globalThis.__rune_receiveHMRMessage = function(payload) {
          try {
            if (typeof payload === "string") {
              payload = JSON.parse(payload);
            }
          } catch (error) {
            console.error('[Rune HMR] parse failed', error);
            return;
          }
          if (payload && typeof globalThis.__rune_refresh === 'function') {
            globalThis.__rune_refresh(payload);
          } else if (payload && typeof globalThis.__rune_requestFullReload === 'function') {
            globalThis.__rune_requestFullReload(payload);
          } else {
            console.warn('[Rune HMR] No refresh handler available', payload && payload.type);
          }
        };
      }
      if (typeof globalThis.__rune_refresh !== 'function') {
        globalThis.__rune_refresh = function(payload) {
          console.warn('[Rune HMR] Refresh invoked with no runtime listener', payload && payload.type);
        };
      }
      """.trimIndent(),
    )
  }

  private fun loadDevBundleIfAvailable(): Boolean {
    val devUrl = devServerUrl ?: return false
    
    root.post { statusBar.showBundleLoading() }
    
    return try {
      val bundle = RuneDevBundleFetcher.fetch(devUrl)
      lastDevBundle = bundle
      Log.d(TAG, "Loaded dev bundle from ${bundle.url}")
      load(bundle.code)
      root.post { statusBar.showBundleLoaded() }
      true
    } catch (t: Throwable) {
      val message = "Dev bundle fetch failed: ${t.message ?: t::class.java.simpleName}"
      Log.w(TAG, message, t)
      root.post { statusBar.showError("Bundle Load Failed") }
      root.showRedBox("Dev Bundle Error", message)
      lastDevBundle?.let {
        Log.d(TAG, "Using cached dev bundle")
        load(it.code)
        root.post { statusBar.showBundleLoaded() }
        return true
      }
      false
    }
  }

  private fun restartAfterReload() {
    val rootId = lastRootId ?: return
    Log.d(TAG, "Restarting app after dev reload rootId=$rootId")
    adapter.callGlobalAsync("__startApp", arrayOf(rootId))
  }

  private fun installDevServerGlobal(url: String) {
    val escaped = url.replace("\\", "\\\\").replace("\"", "\\\"")
    adapter.evaluate("globalThis.__RUNE_DEV_SERVER_URL = \"$escaped\";")
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
      Log.d("RuneUI", "Registering handler: id=$id name=$name fn=${fn?.javaClass?.simpleName}")
      if (fn is Function) {
        handlerMap[id to name] = HandlerRef.Rhino(fn)
        Log.d("RuneUI", "Handler registered in handlerMap")
      } else {
        Log.d("RuneUI", "Handler function is null or not a Function")
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
    Log.d("RuneUI", "dispatchHandler called for id=$id name=$name")
    val key = id to name
    val handler = handlerMap[key]
    Log.d("RuneUI", "Handler function found: ${handler != null}")
    when {
      handler is HandlerRef.Rhino && adapter is RhinoAdapter -> {
        val payload = manager.consumeEventPayload(id, name)
        val eventPayload = mutableMapOf<String, Any?>("target" to id, "type" to name)
        if (payload != null) {
          eventPayload.putAll(payload.toMap())
        }
        val event = adapter.createObject(eventPayload)
        Log.d("RuneUI", "Calling JavaScript function")
        adapter.callFunction(handler.function, arrayOf(event))
      }
      handler is HandlerRef.Hermes && adapter is HermesAdapter -> {
        Log.d("RuneUI", "Dispatching Hermes handler $handler for node $id")
        adapter.invokeHandler(handler.handlerId, id, name)
      }
      else -> Log.d("RuneUI", "No valid handler found for $key")
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
    if (adapter is HermesAdapter) {
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
        return if (constants.isNotEmpty()) JSONObject(constants).toString() else "{}"
    }

    override fun invoke(module: String, method: String, args: Array<Any?>, promiseId: Int) {
      Log.d(TAG, "HermesModulesShim.invoke module=$module method=$method argsCount=${args.size} promiseId=$promiseId")
      moduleExecutor.execute {
        try {
          val result = handleModuleCall(module, method, args)
          Log.d(TAG, "HermesModulesShim.resolve promiseId=$promiseId resultLen=${result.length()}")
          hermes.resolvePromise(promiseId, result.toString())
        } catch (t: Throwable) {
          Log.e(TAG, "HermesModulesShim.reject promiseId=$promiseId: ${t.message}")
          hermes.rejectPromise(promiseId, t.message ?: "error")
        }
      }
    }

    override fun callSync(module: String, method: String, args: Array<Any?>): Any? {
      Log.d(TAG, "HermesModulesShim.callSync module=$module method=$method args=${args.size}")
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

  companion object {
    /**
     * Initialize SoLoader required for Yoga layout engine.
     * Call this before creating any RuneRuntime instances.
     */
    @JvmStatic
    fun initialize(context: Context) {
      SoLoader.init(context, false)
    }

    private const val TAG = "RuneRuntime"
  }
}
