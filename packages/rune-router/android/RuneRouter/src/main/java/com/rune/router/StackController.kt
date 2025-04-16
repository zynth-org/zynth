package com.rune.router

import android.os.Handler
import android.os.Looper
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

private const val STACK_TAG = "RuneStackController"

class StackController(
  private val fragmentManager: FragmentManager,
  @IdRes private val containerId: Int
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val routeStack = mutableListOf<RouteEntry>()
  private var emitter: RuneRouterEmitter? = null
  private var routerModule: RuneRouterModule? = null
  private var focusedKey: String? = null
  private var surfaceView: View? = null
  private var lastStateSignature: String? = null
  private var stackKey: String = "stack-root"

  private fun runOnMainThread(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }

  internal fun bindRouterModule(module: RuneRouterModule, emitter: RuneRouterEmitter) {
    this.routerModule = module
    this.emitter = emitter
    Log.i(STACK_TAG, "Router module bound; routes=${routeStack.size}")
  }

  fun setSurfaceView(view: View) {
    surfaceView = view
    (routeStack.lastOrNull()?.fragment as? ScreenHostFragment)?.attachSurfaceView(view)
    Log.d(STACK_TAG, "Surface view installed; top=${routeStack.lastOrNull()?.name}")
  }

  fun push(name: String, params: JSONObject?, animated: Boolean) {
    Log.d(STACK_TAG, "push(name=$name, animated=$animated)")
    runOnMainThread {
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
      fragmentManager.executePendingTransactions()
      emitState()
      Log.d(STACK_TAG, "Stack after push size=${routeStack.size}")
    }
  }

  fun pop(count: Int, animated: Boolean) {
    if (routeStack.isEmpty()) return
    Log.d(STACK_TAG, "pop(count=$count, animated=$animated) size=${routeStack.size}")
    runOnMainThread {
      // Remove routes from stack immediately
      val targetCount = max(routeStack.size - count, 0)
      while (routeStack.size > targetCount) {
        routeStack.removeLastOrNull()
      }
      
      val targetEntry = routeStack.lastOrNull()
      if (targetEntry == null) {
        fragmentManager.popBackStackImmediate(null, FragmentManager.POP_BACK_STACK_INCLUSIVE)
        Log.w(STACK_TAG, "Pop cleared entire stack")
        emitState()
        return@runOnMainThread
      }
      
      fragmentManager.popBackStack(targetEntry.key, 0)
      fragmentManager.executePendingTransactions()
      emitState()
      Log.d(STACK_TAG, "Stack after pop size=${routeStack.size}")
    }
  }

  fun replaceTop(name: String, params: JSONObject?, animated: Boolean) {
    if (routeStack.isEmpty()) {
      push(name, params, animated)
      return
    }
    Log.d(STACK_TAG, "replaceTop(name=$name, animated=$animated)")
    routeStack.removeLast()
    push(name, params, animated)
  }

  fun reset(state: JSONObject, animated: Boolean) {
    Log.i(STACK_TAG, "reset(animated=$animated) routes=${state.optJSONArray("routes")?.length() ?: 0}")
    runOnMainThread {
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
      fragmentManager.executePendingTransactions()
      emitState()
      Log.i(STACK_TAG, "Stack reset complete size=${routeStack.size} key=$stackKey")
    }
  }

  fun setParams(routeKey: String, params: JSONObject) {
    Log.d(STACK_TAG, "setParams(routeKey=$routeKey)")
    val entry = routeStack.find { it.key == routeKey } ?: return
    entry.params = params
    (entry.fragment as? ScreenHostFragment)?.updateParams(params)
    emitState()
  }

  fun applyOptions(routeKey: String, options: JSONObject) {
    Log.d(STACK_TAG, "applyOptions(routeKey=$routeKey)")
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

  internal fun onFragmentShown(fragment: ScreenHostFragment) {
    Log.i(STACK_TAG, "fragment shown route=${fragment.routeKey}")
    val key = fragment.routeKey
    if (key != focusedKey) {
      focusedKey?.let { emitter?.emitBlur(it) }
      emitter?.emitFocus(key)
      focusedKey = key
    }
    val surface = surfaceView
    if (surface != null) {
      Log.i(STACK_TAG, "Attaching surface to fragment ${fragment.routeKey}")
      fragment.attachSurfaceView(surface)
    } else {
      Log.w(STACK_TAG, "No surface view available to attach to ${fragment.routeKey}")
    }
  }

  private fun emitState() {
    val payload = currentState()
    val signature = payload.toString()
    if (signature == lastStateSignature) {
      return
    }
    lastStateSignature = signature
    emitter?.emitState(payload)
    Log.v(STACK_TAG, "emitState routes=${routeStack.size}")
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
