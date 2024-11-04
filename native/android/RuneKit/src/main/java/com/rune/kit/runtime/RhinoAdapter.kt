package com.rune.kit.runtime

import org.mozilla.javascript.BaseFunction
import org.mozilla.javascript.Context
import org.mozilla.javascript.Function
import org.mozilla.javascript.NativeJSON
import org.mozilla.javascript.NativeObject
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.ScriptableObject
import org.mozilla.javascript.Undefined

class RhinoAdapter : JSRuntimeAdapter {
  private val cx: Context = Context.enter().apply {
    optimizationLevel = -1
    languageVersion = Context.VERSION_ES6
  }
  private val scope: Scriptable = cx.initStandardObjects()
  override var onException: ((String) -> Unit)? = null

  override fun setGlobalObject(name: String, value: Any) {
    val jsObj = Context.javaToJS(value, scope)
    ScriptableObject.putProperty(scope, name, jsObj)
  }

  override fun setGlobalFunction(name: String, fn: (Array<Any?>) -> Any?) {
    val function = object : BaseFunction() {
      override fun call(
        cx: Context,
        scope: Scriptable,
        thisObj: Scriptable,
        args: Array<out Any?>,
      ): Any? {
        return try {
          fn(args as Array<Any?>) ?: Undefined.instance
        } catch (t: Throwable) {
          onException?.invoke(t.message ?: t.toString())
          Undefined.instance
        }
      }
    }
    ScriptableObject.putProperty(scope, name, function)
  }

  override fun evaluate(code: String) {
    try {
      cx.evaluateString(scope, code, "bundle.js", 1, null)
    } catch (t: Throwable) {
      onException?.invoke(t.message ?: t.toString())
    }
  }

  override fun callGlobal(name: String, args: Array<Any?>): Any? {
    val fn = ScriptableObject.getProperty(scope, name)
    if (fn !is Function) return null
    return callFunction(fn, args)
  }

  fun callFunction(fn: Function, args: Array<Any?> = emptyArray()): Any? {
    return try {
      val jsArgs = args.map { Context.javaToJS(it, scope) }.toTypedArray()
      fn.call(cx, scope, scope, jsArgs)
    } catch (t: Throwable) {
      onException?.invoke(t.message ?: t.toString())
      null
    }
  }

  fun parseJson(json: String): Any? {
    return try {
      NativeJSON.parse(cx, scope, json, null)
    } catch (t: Throwable) {
      onException?.invoke(t.message ?: t.toString())
      null
    }
  }

  fun createObject(map: Map<String, Any?>): NativeObject {
    val obj = NativeObject()
    for ((key, value) in map) {
      ScriptableObject.putProperty(obj, key, Context.javaToJS(value, scope))
    }
    return obj
  }
}
