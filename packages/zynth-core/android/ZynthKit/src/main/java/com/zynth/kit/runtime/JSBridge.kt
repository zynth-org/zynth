package com.zynth.kit.runtime

import android.util.Log

internal object JSBridge {
  init {
    try {
      System.loadLibrary("zynthkit")
    } catch (error: Throwable) {
      Log.e("ZynthJSBridge", "Failed to load libzynthkit.so", error)
      throw error
    }
  }

  external fun createHermesRuntime(): Long
  external fun destroyHermesRuntime(runtimePtr: Long)
  external fun installUIBindings(runtimePtr: Long, manager: com.zynth.kit.core.ZynthUIManager)
  external fun installModuleRegistry(runtimePtr: Long, registry: ZynthModuleRegistry)
  external fun evaluateScript(runtimePtr: Long, code: String, sourceUrl: String?)
  external fun loadBytecode(runtimePtr: Long, bytecode: ByteArray, sourceUrl: String?)
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
  external fun invokeEvent(runtimePtr: Long, nodeId: Int, name: String, payloadJson: String?)
  external fun invokePressEvent(
    runtimePtr: Long,
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
  external fun invokeLayoutEvent(runtimePtr: Long, nodeId: Int, x: Double, y: Double, width: Double, height: Double)
  external fun invokeLayoutEventsBatch(runtimePtr: Long, payload: DoubleArray)
  external fun invokeLayoutEventsBatchSlice(runtimePtr: Long, payload: DoubleArray, length: Int)
  external fun invokeTimer(runtimePtr: Long, timerId: Int)
  external fun invokeAnimationFrame(runtimePtr: Long, callbackId: Int, timestampMs: Double)
  external fun setSharedSignal(runtimePtr: Long, id: Int, value: Double)
  external fun getSharedSignal(runtimePtr: Long, id: Int): Double
  external fun cancelSharedSignalAnimation(runtimePtr: Long, id: Int): Boolean
  external fun setSyncSignal(runtimePtr: Long, id: Int, value: String): Boolean
  external fun getSyncSignal(runtimePtr: Long, id: Int, value: StringBuilder): Boolean
  external fun registerWorkletOnUiRuntime(runtimePtr: Long, workletId: Int)
  external fun runWorkletOnUiRuntime(runtimePtr: Long, workletId: Int)
  external fun runInputHandlerOnUiRuntime(
    runtimePtr: Long,
    workletId: Int,
    currentText: String,
    newInput: String,
    proposedText: String,
  ): String?

  private val workletHandler = android.os.Handler(android.os.Looper.getMainLooper())

  @JvmStatic
  fun postRegisterWorklet(runtimePtr: Long, workletId: Int) {
    workletHandler.post {
      registerWorkletOnUiRuntime(runtimePtr, workletId)
    }
  }

  @JvmStatic
  fun postRunWorklet(runtimePtr: Long, workletId: Int, delayMs: Long) {
    val runnable = Runnable {
      runWorkletOnUiRuntime(runtimePtr, workletId)
    }
    if (delayMs <= 0L) {
      workletHandler.post(runnable)
    } else {
      workletHandler.postDelayed(runnable, delayMs)
    }
  }
}
