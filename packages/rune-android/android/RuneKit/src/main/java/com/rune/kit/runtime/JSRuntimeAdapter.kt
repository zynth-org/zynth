package com.rune.kit.runtime

interface JSRuntimeAdapter {
  var onException: ((JsRuntimeException) -> Unit)?
  fun setGlobalObject(name: String, value: Any)
  fun setGlobalFunction(name: String, fn: (Array<Any?>) -> Any?)
  fun evaluate(code: String)
  fun callGlobal(name: String, args: Array<Any?> = emptyArray()): Any?
  fun callGlobalAsync(name: String, args: Array<Any?> = emptyArray()) {
    callGlobal(name, args)
  }
}
