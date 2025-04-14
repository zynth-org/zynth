package com.rune.router

import android.util.Log
import android.view.View
import android.view.ViewGroup
import androidx.annotation.IdRes
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentManager
import androidx.fragment.app.commit
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.max

internal class StackController(
  private val fragmentManager: FragmentManager,
  @IdRes private val containerId: Int
) {
  private val routeStack = mutableListOf<RouteEntry>()
  private var emitter: RuneRouterEmitter? = null
  private var routerModule: RuneRouterModule? = null
  private var focusedKey: String? = null
  private var surfaceView: View? = null
  private var lastStateSignature: String? = null
  private var stackKey: String = "stack-root"

  fun bindRouterModule(module: RuneRouterModule, emitter: RuneRouterEmitter) {
    this.routerModule = module
    this.emitter = emitter
  }

  fun setSurfaceView(view: View) {
    surfaceView = view
    (view.parent as? ViewGroup)?.removeView(view)
    routeStack.lastOrNull()?.controller?.attachSurfaceView(view)
  }

  fun push(name: String, params: JSONObject?, animated: Boolean) {
    val entry = RouteEntry(name = name, params = params)
    routeStack.add(entry)
    val fragment = ScreenHostFragment.newInstance(entry.key, name, params)
    entry.fragment = fragment
    RouterControllerRegistry.register(entry.key, this)

    fragmentManager.commit {
      setReorderingAllowed(true)
      if (!animated) {
        setCustomAnimations(0, 0, 0, 0)
      }
      replace(containerId, fragment, entry.key)
      addToBackStack(entry.key)
    }
    emitState()
  }

  fun pop(count: Int, animated: Boolean) {
    if (routeStack.isEmpty()) return
    val targetIndex = max(routeStack.size - count - 1, 0)
    val targetEntry = routeStack.getOrNull(targetIndex)
    if (targetEntry == null) {
      fragmentManager.popBackStackImmediate(null, FragmentManager.POP_BACK_STACK_INCLUSIVE)
      routeStack.clear()
      return
    }
    fragmentManager.popBackStack(targetEntry.key, 0)
    while (routeStack.lastOrNull()?.key != targetEntry.key) {
      routeStack.removeLastOrNull()
    }
    emitState()
  }

  fun replaceTop(name: String, params: JSONObject?, animated: Boolean) {
    if (routeStack.isEmpty()) {
      push(name, params, animated)
      return
    }
    routeStack.removeLast()
    push(name, params, animated)
  }

  fun reset(state: JSONObject, animated: Boolean) {
    val routes = state.optJSONArray("routes") ?: JSONArray()
    stackKey = state.optString("key", stackKey)
    routeStack.clear()
    fragmentManager.popBackStackImmediate(null, FragmentManager.POP_BACK_STACK_INCLUSIVE)
    for (i in 0 until routes.length()) {
      val route = routes.optJSONObject(i) ?: continue
      val name = route.optString("name", null) ?: continue
      val params = route.optJSONObject("params")
      val key = route.optString("key", UUID.randomUUID().toString())
      val entry = RouteEntry(name = name, params = params, key = key)
      val fragment = ScreenHostFragment.newInstance(entry.key, name, params)
      entry.fragment = fragment
      routeStack.add(entry)
      RouterControllerRegistry.register(entry.key, this)
      fragmentManager.commit {
        setReorderingAllowed(true)
        replace(containerId, fragment, entry.key)
        addToBackStack(entry.key)
      }
    }
    emitState()
  }

  fun setParams(routeKey: String, params: JSONObject) {
    val entry = routeStack.find { it.key == routeKey } ?: return
    entry.params = params
    (entry.fragment as? ScreenHostFragment)?.updateParams(params)
    emitState()
  }

  fun applyOptions(routeKey: String, options: JSONObject) {
    val entry = routeStack.find { it.key == routeKey } ?: return
    entry.options = options
    (entry.fragment as? ScreenHostFragment)?.applyOptions(options)
  }

  fun currentState(): JSONObject {
    val routes = JSONArray()
    routeStack.forEach { routes.put(it.asJson()) }
    return JSONObject()
      .put("key", stackKey)
      .put("type", "stack")
      .put("index", max(routes.length() - 1, 0))
      .put("routes", routes)
  }

  fun onFragmentShown(fragment: ScreenHostFragment) {
    emitState()
    val key = fragment.routeKey
    if (key != focusedKey) {
      focusedKey?.let { emitter?.emitBlur(it) }
      emitter?.emitFocus(key)
      focusedKey = key
    }
    surfaceView?.let { fragment.attachSurfaceView(it) }
  }

  private fun emitState() {
    val payload = currentState()
    val signature = payload.toString()
    if (signature == lastStateSignature) {
      return
    }
    lastStateSignature = signature
    emitter?.emitState(payload)
  }

  private data class RouteEntry(
    val name: String,
    var params: JSONObject?,
    val key: String = UUID.randomUUID().toString(),
    var fragment: Fragment? = null,
    var options: JSONObject? = null
  ) {
    fun asJson(): JSONObject {
      val json = JSONObject()
        .put("key", key)
        .put("name", name)
      params?.let { json.put("params", it) }
      return json
    }
  }
}
