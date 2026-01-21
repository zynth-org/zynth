package com.zynth.kit.runtime

internal object JSBridge {
  init {
    try {
      System.loadLibrary("zynthkit")
    } catch (_: Throwable) {
      // Native bindings are not available in phase 1.
    }
  }

  external fun createHermesRuntime(): Long
  external fun destroyHermesRuntime(runtimePtr: Long)
  external fun installUIBindings(runtimePtr: Long, manager: com.zynth.kit.core.ZynthUIManager)
  external fun evaluateScript(runtimePtr: Long, code: String, sourceUrl: String?)
  external fun callGlobalDouble(runtimePtr: Long, name: String, value: Double)
  external fun callGlobalFrame(
    runtimePtr: Long,
    name: String,
    frameMs: Double,
    layoutMs: Double,
    overBudget: Boolean,
    nodeCount: Int
  )
  external fun emitEvent(runtimePtr: Long, name: String, payloadJson: String?)
  external fun invokeEvent(nodeId: Int, name: String, payloadJson: String?)
  external fun invokePressEvent(
    nodeId: Int,
    name: String,
    x: Double,
    y: Double,
    screenX: Double,
    screenY: Double,
    durationMs: Double,
    timestampMs: Double,
    cancelled: Boolean
  )
  external fun invokeLayoutEvent(nodeId: Int, x: Double, y: Double, width: Double, height: Double)
}
