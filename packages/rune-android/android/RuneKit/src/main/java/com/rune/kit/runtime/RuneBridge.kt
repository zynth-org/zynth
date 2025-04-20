package com.rune.kit.runtime

import android.util.Log
import com.rune.kit.core.RuneUIManager
import org.json.JSONArray
import org.json.JSONObject

object RuneBridge {
  private const val TAG = "RuneBridge"

  init {
    try {
      System.loadLibrary("rune_kit")
    } catch (t: Throwable) {
      Log.w(TAG, "Native library load failed; falling back to Kotlin bridge", t)
    }
  }

  fun install(adapter: JSRuntimeAdapter, manager: RuneUIManager) {
    try {
      nativeInstallBindings(adapter, manager)
    } catch (err: UnsatisfiedLinkError) {
      Log.w(TAG, "Native bindings unavailable; using fallback", err)
    }
    // TODO: drop fallback once native bridge registers __ui/__modules via Hermes.
    installFallback(adapter, manager)
  }

  private fun installFallback(adapter: JSRuntimeAdapter, manager: RuneUIManager) {
    val createNode: (Array<Any?>) -> Any? = { args ->
      val type = (args.getOrNull(0) as? String) ?: "view"
      manager.createNode(type)
    }
    val setProp: (Array<Any?>) -> Any? = set@ { args ->
      val id = (args.getOrNull(0) as? Number)?.toInt() ?: return@set null
      val name = (args.getOrNull(1) as? String) ?: return@set null
      val value = args.getOrNull(2)
      if (name == "onPress") {
        // TODO: capture JS function pointer once runtime wiring is complete
        manager.setHandler(id, name, 0L)
      } else {
        manager.setProp(id, name, toJsonString(value))
      }
      null
    }
    val setText: (Array<Any?>) -> Any? = setText@ { args ->
      val id = (args.getOrNull(0) as? Number)?.toInt() ?: return@setText null
      val text = args.getOrNull(1)?.toString() ?: ""
      manager.setText(id, text)
      null
    }
    val insertChild: (Array<Any?>) -> Any? = insert@ { args ->
      val parent = (args.getOrNull(0) as? Number)?.toInt() ?: return@insert null
      val child = (args.getOrNull(1) as? Number)?.toInt() ?: return@insert null
      val index = (args.getOrNull(2) as? Number)?.toInt() ?: 0
      manager.insertChild(parent, child, index)
      null
    }
    val removeChild: (Array<Any?>) -> Any? = remove@ { args ->
      val parent = (args.getOrNull(0) as? Number)?.toInt() ?: return@remove null
      val child = (args.getOrNull(1) as? Number)?.toInt() ?: return@remove null
      manager.removeChild(parent, child)
      null
    }
    val setHandler: (Array<Any?>) -> Any? = handler@ { args ->
      val id = (args.getOrNull(0) as? Number)?.toInt() ?: return@handler null
      val name = (args.getOrNull(1) as? String) ?: return@handler null
      val fnRef = (args.getOrNull(2) as? Number)?.toLong() ?: 0L
      manager.setHandler(id, name, fnRef)
      null
    }
    val flush: (Array<Any?>) -> Any? = {
      manager.flush()
      null
    }
    val applyBatch: (Array<Any?>) -> Any? = { args ->
      val raw = args.getOrNull(0)?.toString()
      if (!raw.isNullOrBlank()) {
        manager.applyBatch(raw)
      }
      null
    }

    val setSurface: (Array<Any?>) -> Any? = setSurface@{ args ->
      val surfaceId = (args.getOrNull(0) as? Number)?.toInt() ?: return@setSurface null
      manager.setActiveSurface(surfaceId)
      null
    }
    
    val logPerformanceStats: (Array<Any?>) -> Any? = {
      manager.logPerformanceStats()
      null
    }

    adapter.setGlobalObject(
      "__ui",
      mapOf(
        "createNode" to createNode,
        "setProp" to setProp,
        "setText" to setText,
        "insertChild" to insertChild,
        "removeChild" to removeChild,
        "setHandler" to setHandler,
        "flush" to flush,
        "applyBatch" to applyBatch,
        "setSurface" to setSurface,
        "logPerformanceStats" to logPerformanceStats,
      ),
    )
  }

  @JvmStatic
  private external fun nativeInstallBindings(adapter: JSRuntimeAdapter, manager: RuneUIManager)
}

private fun toJsonString(value: Any?): String {
  if (value == null) return "{}"
  return when (value) {
    is Map<*, *> -> JSONObject(value).toString()
    is List<*> -> JSONArray(value).toString()
    is Array<*> -> JSONArray(value).toString()
    is String -> {
      // If the string looks like already-serialized JSON (starts with { or [),
      // pass it through as-is. Otherwise, wrap it as a JSON string.
      val trimmed = value.trim()
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        // Already serialized JSON, pass through directly
        trimmed
      } else {
        // Regular string, wrap it in JSON
        JSONObject.wrap(value)?.toString() ?: value
      }
    }
    is Number, is Boolean -> JSONObject.wrap(value)?.toString() ?: value.toString()
    else -> JSONObject.wrap(value)?.toString() ?: "{}"
  }
}

private fun <T> Array<out T>.getOrNull(index: Int): T? = if (index in indices) this[index] else null
