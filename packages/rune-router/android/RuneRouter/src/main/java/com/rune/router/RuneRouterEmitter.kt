package com.rune.router

import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject

internal class RuneRouterEmitter(private val runtime: RuneRuntime) {
  fun emitState(state: JSONObject) {
    runtime.emitEvent("rune.router.stateChanged", JSONObject().put("state", state))
  }

  fun emitTransitionStart(key: String, progress: Double = 0.0) {
    runtime.emitEvent(
      "rune.router.transitionStart",
      JSONObject().put("key", key).put("progress", progress)
    )
  }

  fun emitTransitionEnd(key: String, finished: Boolean) {
    runtime.emitEvent(
      "rune.router.transitionEnd",
      JSONObject().put("key", key).put("finished", finished)
    )
  }

  fun emitTransitionProgress(key: String, progress: Double) {
    runtime.emitEvent(
      "rune.router.transitionProgress",
      JSONObject().put("key", key).put("progress", progress)
    )
  }

  fun emitFocus(key: String) {
    runtime.emitEvent("rune.router.focus", JSONObject().put("key", key))
  }

  fun emitBlur(key: String) {
    runtime.emitEvent("rune.router.blur", JSONObject().put("key", key))
  }

  fun emitPredictiveBack(key: String, progress: Double, velocity: Double?) {
    val payload = JSONObject()
      .put("key", key)
      .put("progress", progress)
    if (velocity != null) {
      payload.put("velocity", velocity)
    }
    runtime.emitEvent("rune.router.predictiveBack", payload)
  }

  fun emitBeforeRemove(action: JSONObject, key: String, requestId: String) {
    val payload = JSONObject()
      .put("key", key)
      .put("action", action)
      .put("requestId", requestId)
    runtime.emitEvent("rune.router.beforeRemove", payload)
  }
}
