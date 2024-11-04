package com.rune.kit.runtime

import android.util.Log

class HermesAdapter : JSRuntimeAdapter {
  override var onException: ((String) -> Unit)? = null
  private val objects = HashMap<String, Any>()
  private val functions = HashMap<String, (Array<Any?>) -> Any?>()

  override fun setGlobalObject(name: String, value: Any) {
    objects[name] = value
    Log.d(TAG, "setGlobalObject($name)")
  }

  override fun setGlobalFunction(name: String, fn: (Array<Any?>) -> Any?) {
    functions[name] = fn
    Log.d(TAG, "setGlobalFunction($name)")
  }

  override fun evaluate(code: String) {
    Log.d(TAG, "evaluate(code len=${code.length})")
    // TODO: load JS bundle via Hermes once bindings are ready
  }

  override fun callGlobal(name: String, args: Array<Any?>): Any? {
    Log.d(TAG, "callGlobal($name)")
    val fn = functions[name]
    return if (fn != null) {
      fn(args)
    } else {
      Log.w(TAG, "Global $name not bound")
      null
    }
  }

  companion object {
    private const val TAG = "HermesAdapter"
  }
}
