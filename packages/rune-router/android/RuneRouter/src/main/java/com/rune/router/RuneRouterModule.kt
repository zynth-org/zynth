package com.rune.router

import android.util.Log
import android.view.View
import androidx.annotation.IdRes
import androidx.fragment.app.FragmentManager
import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneRuntime
import com.rune.kit.runtime.RuneSyncModule
import org.json.JSONObject
import java.util.UUID

private const val MODULE_TAG = "RuneRouterModule"

class RuneRouterModule(
  private val runtime: RuneRuntime,
  private val stackController: StackController
) : RuneModule, RuneSyncModule {

  override val name: String = "RuneRouter"

  private val emitter = RuneRouterEmitter(runtime)
  private val beforeRemoveResolvers = mutableMapOf<String, (Boolean) -> Unit>()

  init {
    stackController.bindRouterModule(this, emitter)
    Log.i(MODULE_TAG, "Module initialized; stack controller bound")
  }

  override fun call(method: String, args: Array<Any?>): JSONObject {
    Log.i(MODULE_TAG, "call(method=$method) args.size=${args.size}")
    val firstArg = args.firstOrNull()
    if (firstArg != null) {
      Log.i(MODULE_TAG, "call first arg type: ${firstArg.javaClass.name}")
      Log.i(MODULE_TAG, "call first arg: $firstArg")
    }
    return when (method) {
      "dispatch" -> {
        val payload = convertToJsonObject(firstArg) ?: run {
          Log.e(MODULE_TAG, "Failed to convert payload to JSONObject")
          return error("invalid_action")
        }
        Log.i(MODULE_TAG, "Payload converted: $payload")
        val action = payload.optJSONObject("action") ?: run {
          Log.e(MODULE_TAG, "No action field in payload")
          return error("invalid_action")
        }
        Log.i(MODULE_TAG, "About to call handleDispatch with action: $action")
        handleDispatch(action)
        JSONObject().put("result", "ok")
      }
      "setOptions" -> {
        val payload = convertToJsonObject(firstArg) ?: return error("invalid_options")
        val key = payload.optString("key", null) ?: return error("invalid_key")
        val options = payload.optJSONObject("options") ?: JSONObject()
        stackController.applyOptions(key, options)
        JSONObject().put("result", "ok")
      }
      "registerScreens" -> JSONObject().put("result", "ok")
      "resolveBeforeRemove" -> {
        val payload = convertToJsonObject(firstArg) ?: return error("invalid_request")
        val requestId = payload.optString("requestId", null) ?: return error("missing_request")
        val cancelled = payload.optBoolean("cancelled", false)
        beforeRemoveResolvers.remove(requestId)?.invoke(!cancelled)
        JSONObject().put("result", "ok")
      }
      else -> error("unknown_method")
    }
  }

  override fun callSync(method: String, args: Array<Any?>): Any? {
    Log.d(MODULE_TAG, "callSync(method=$method)")
    return when (method) {
      "getState" -> JSONObject().put("state", stackController.currentState())
      else -> throw UnsupportedOperationException("Unsupported method $method")
    }
  }

  fun requestBeforeRemove(routeKey: String, action: JSONObject, completion: (Boolean) -> Unit) {
    Log.d(MODULE_TAG, "requestBeforeRemove(routeKey=$routeKey)")
    val requestId = UUID.randomUUID().toString()
    beforeRemoveResolvers[requestId] = completion
    emitter.emitBeforeRemove(action, routeKey, requestId)
  }
  
  fun setOnSurfaceAttachedCallback(callback: () -> Unit) {
    stackController.setOnSurfaceAttachedCallback(callback)
  }

  private fun handleDispatch(action: JSONObject) {
    val type = action.optString("type")
    Log.i(MODULE_TAG, "handleDispatch(type=$type) action=$action")
    when (type) {
      "PUSH", "NAVIGATE" -> {
        val payload = action.optJSONObject("payload") ?: return
        val name = payload.optString("name", null) ?: return
        val params = payload.optJSONObject("params")
        stackController.push(name, params, true)
      }
      "POP" -> {
        val payload = action.optJSONObject("payload")
        val count = payload?.optInt("count", 1) ?: 1
        stackController.pop(count, true)
      }
      "REPLACE" -> {
        val payload = action.optJSONObject("payload") ?: return
        val name = payload.optString("name", null) ?: return
        val params = payload.optJSONObject("params")
        stackController.replaceTop(name, params, true)
      }
      "RESET" -> {
        val state = action.optJSONObject("state") ?: return
        stackController.reset(state, true)
      }
      "SET_PARAMS" -> {
        val source = action.optString("source", null) ?: return
        val params = action.optJSONObject("payload") ?: JSONObject()
        stackController.setParams(source, params)
      }
      else -> Log.w(MODULE_TAG, "Unsupported action $type")
    }
  }

  private fun error(message: String): JSONObject = JSONObject().put("error", message)

  private fun convertToJsonObject(value: Any?): JSONObject? {
    return when (value) {
      is JSONObject -> value
      is Map<*, *> -> {
        val json = JSONObject()
        value.forEach { (k, v) -> 
          if (k is String) {
            json.put(k, convertToJsonValue(v))
          }
        }
        json
      }
      else -> null
    }
  }

  private fun convertToJsonValue(value: Any?): Any? {
    return when (value) {
      null -> JSONObject.NULL
      is Map<*, *> -> convertToJsonObject(value)
      is List<*> -> {
        val array = org.json.JSONArray()
        value.forEach { array.put(convertToJsonValue(it)) }
        array
      }
      is Array<*> -> {
        val array = org.json.JSONArray()
        value.forEach { array.put(convertToJsonValue(it)) }
        array
      }
      is Number, is String, is Boolean -> value
      else -> value.toString()
    }
  }

  companion object {
    fun attach(
      runtime: RuneRuntime,
      fragmentManager: FragmentManager,
      @IdRes containerId: Int,
      surfaceView: View
    ): RuneRouterModule {
      Log.i(MODULE_TAG, "attach called; containerId=$containerId")
      val controller = StackController(fragmentManager, containerId)
      val module = RuneRouterModule(runtime, controller)
      // Install surface BEFORE registering module so it's available when JS resets the stack
      controller.setSurfaceView(surfaceView)
      Log.i(MODULE_TAG, "Module created with name='${module.name}'")
      Log.i(MODULE_TAG, "About to call runtime.installModules")
      runtime.installModules(listOf(module))
      Log.i(MODULE_TAG, "runtime.installModules completed")
      return module
    }
  }
}
