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
  external fun axonComputeLayout(runtimePtr: Long, rootId: Int, width: Float, height: Float): Boolean
  external fun axonCollectFrames(runtimePtr: Long, nodeIds: IntArray, outFrames: FloatArray): Boolean
  external fun axonSetStyleNumber(runtimePtr: Long, nodeId: Int, propId: Int, value: Float): Boolean
  external fun axonSetStyleString(runtimePtr: Long, nodeId: Int, propId: Int, value: String): Boolean
  external fun axonRegisterResolvedFont(
    runtimePtr: Long,
    family: String,
    weight: Int,
    italic: Boolean,
    sizePx: Float,
  ): Int
  external fun axonPrewarmResolvedFont(
    runtimePtr: Long,
    family: String,
    weight: Int,
    italic: Boolean,
    sizePx: Float,
  ): Int
  external fun axonInvalidateFontCache(runtimePtr: Long, fontId: Int): Boolean
  external fun axonSetTextMeasure(runtimePtr: Long, nodeId: Int, text: String, fontId: Int): Boolean
  external fun axonSetMeasureHandler(runtimePtr: Long, nodeId: Int, enabled: Boolean): Boolean
  external fun axonMeasureNode(
    runtimePtr: Long,
    nodeId: Int,
    width: Float,
    widthMode: Int,
    height: Float,
    heightMode: Int,
  ): FloatArray?

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
