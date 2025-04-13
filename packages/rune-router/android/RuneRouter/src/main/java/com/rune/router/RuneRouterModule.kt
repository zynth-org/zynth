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

class RuneRouterModule(
  private val runtime: RuneRuntime,
  private val stackController: StackController
) : RuneModule, RuneSyncModule {

  override val name: String = "RuneRouter"

  private val emitter = RuneRouterEmitter(runtime)
  private val beforeRemoveResolvers = mutableMapOf<String, (Boolean) -> Unit>()

  init {
    stackController.bindRouterModule(this, emitter)
  }

  override fun call(method: String, args: Array<Any?>): JSONObject {
    return when (method) {
      "dispatch" -> {
        val payload = args.firstOrNull() as? JSONObject ?: return error("invalid_action")
        val action = payload.optJSONObject("action") ?: return error("invalid_action")
        handleDispatch(action)
        JSONObject().put("result", "ok")
      }
      "setOptions" -> {
        val payload = args.firstOrNull() as? JSONObject ?: return error("invalid_options")
        val key = payload.optString("key", null) ?: return error("invalid_key")
        val options = payload.optJSONObject("options") ?: JSONObject()
        stackController.applyOptions(key, options)
        JSONObject().put("result", "ok")
      }
      "registerScreens" -> JSONObject().put("result", "ok")
      "resolveBeforeRemove" -> {
        val payload = args.firstOrNull() as? JSONObject ?: return error("invalid_request")
        val requestId = payload.optString("requestId", null) ?: return error("missing_request")
        val cancelled = payload.optBoolean("cancelled", false)
        beforeRemoveResolvers.remove(requestId)?.invoke(!cancelled)
        JSONObject().put("result", "ok")
      }
      else -> error("unknown_method")
    }
  }

  override fun callSync(method: String, args: Array<Any?>): Any? {
    return when (method) {
      "getState" -> JSONObject().put("state", stackController.currentState())
      else -> throw UnsupportedOperationException("Unsupported method $method")
    }
  }

  fun requestBeforeRemove(routeKey: String, action: JSONObject, completion: (Boolean) -> Unit) {
    val requestId = UUID.randomUUID().toString()
    beforeRemoveResolvers[requestId] = completion
    emitter.emitBeforeRemove(action, routeKey, requestId)
  }

  fun installSurfaceView(view: View) {
    stackController.setSurfaceView(view)
  }

  private fun handleDispatch(action: JSONObject) {
    when (action.optString("type")) {
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
      else -> Log.w("RuneRouterModule", "Unsupported action ${action.optString("type")}")
    }
  }

  private fun error(message: String): JSONObject = JSONObject().put("error", message)

  companion object {
    fun attach(
      runtime: RuneRuntime,
      fragmentManager: FragmentManager,
      @IdRes containerId: Int
    ): RuneRouterModule {
      val controller = StackController(fragmentManager, containerId)
      val module = RuneRouterModule(runtime, controller)
      runtime.installModules(listOf(module))
      return module
    }
  }
}
