package com.rune.kit.runtime

import android.content.Context
import android.util.Log
import com.facebook.soloader.SoLoader
import com.rune.kit.core.RuneRootView
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.YogaLayoutEngine
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
  private val manager = RuneUIManager(
    root,
    YogaLayoutEngine(root.rootId),
    eventDispatcher = { id, name -> dispatchHandler(id, name) },
    handlerListener = { id, name, handlerRef -> onHandlerAttached(id, name, handlerRef) },
  )

  init {
    installConsole()
    when (adapter) {
      is RhinoAdapter -> {
        installRhinoGlobals(adapter)
        installRhinoBridge(adapter)
      }
      is HermesAdapter -> installHermesBindings(adapter)
      else -> installFallbackBridge()
    }
  }

  fun installModules(modules: List<RuneModule>) {
    modules.forEach { registry.register(it) }
  }

  fun load(code: String) {
    adapter.onException = { Log.e("JS", it) }
    adapter.evaluate(code)
  }

  fun start(rootId: Int) {
    adapter.callGlobal("__startApp", arrayOf(rootId))
  }

  fun destroy() {
    moduleExecutor.shutdownNow()
    if (adapter is HermesAdapter) {
      adapter.destroy()
    }
  }

  private fun installConsole() {
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
      val payload = args.stringAt(2) ?: "{}"
      val result = handleModuleCall(name, method, payload)
      if (result.isBlank()) return@setGlobalFunction emptyMap<String, Any?>()
      rhino.parseJson(result) ?: emptyMap<String, Any?>()
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
          val argsJson = toJsonString(argv.getOrNull(2))
          parseJson(handleModuleCall(name, method, argsJson))
        },
      ),
    )
  }

  private fun handleModuleCall(name: String, method: String, argsJson: String): String {
    return registry.call(name, method, argsJson)
  }

  private fun dispatchHandler(id: Int, name: String) {
    Log.d("RuneUI", "dispatchHandler called for id=$id name=$name")
    val key = id to name
    val handler = handlerMap[key]
    Log.d("RuneUI", "Handler function found: ${handler != null}")
    when {
      handler is HandlerRef.Rhino && adapter is RhinoAdapter -> {
        val event = adapter.createObject(mapOf("target" to id))
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
    override fun invoke(module: String, method: String, args: Array<Any?>, promiseId: Int) {
      moduleExecutor.execute {
        try {
          val argsPayload = args.firstOrNull()
          val argsJson = toJsonString(argsPayload)
          val result = handleModuleCall(module, method, argsJson)
          hermes.resolvePromise(promiseId, result)
        } catch (t: Throwable) {
          hermes.rejectPromise(promiseId, t.message ?: "error")
        }
      }
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
  }
}
