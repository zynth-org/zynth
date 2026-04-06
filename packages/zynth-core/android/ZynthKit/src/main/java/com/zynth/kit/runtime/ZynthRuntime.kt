package com.zynth.kit.runtime

import android.content.Context
import android.content.res.AssetManager
import com.facebook.soloader.SoLoader
import com.zynth.kit.core.AssetProvider
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.core.addSurfaceFirstFrameListener
import com.zynth.kit.runtime.modules.CoreSystemModule
import com.zynth.kit.runtime.modules.DevtoolsModule
import com.zynth.kit.runtime.modules.FetchModule
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.Choreographer
import java.util.concurrent.CountDownLatch
import org.json.JSONArray
import org.json.JSONObject

class ZynthRuntime(val root: ZynthRootView) {
  private val uiManager = ZynthUIManager(root)
  private val runtimePtr: Long
  internal val startupMetrics = ZynthStartupMetrics()
  private val registry = ZynthModuleRegistry()
  private val jsThread = HandlerThread("ZynthJS")
  private val jsHandler: Handler
  private var performanceJsTickerActive: Boolean = false
  private var performanceJsTicker: Runnable? = null
  private val startupStateLock = Any()
  private var hasStarted: Boolean = false
  private var isBundleLoaded: Boolean = false
  private var pendingStartRootId: Int? = null
  val bridgeSessionId: String = java.util.UUID.randomUUID().toString()
  init {
    if (isStartupMetricsBootstrapEnabled()) {
      startupMetrics.enableFeatures(listOf("startupTime"))
    }
    startupMetrics.markRuntimeConstructStart()
    runtimePtr = JSBridge.createHermesRuntime()
    startupMetrics.markRuntimeConstructEnd()
    startupMetrics.markRuntimeCreated()
    jsThread.start()
    jsHandler = Handler(jsThread.looper)
    uiManager.setJSHandler(jsHandler)
    uiManager.setRuntimePtr(runtimePtr)
    uiManager.firstMountCommitListener = {
      startupMetrics.markFirstCommit()
    }
    uiManager.setFrameProfiler { frameMs, layoutMs, overBudget, nodeCount ->
      startupMetrics.recordFrame(frameMs, layoutMs)
      ZynthNativePerformanceOverlay.recordPerformanceFrame(nodeCount)
      runOnJS {
        JSBridge.callGlobalFrame(runtimePtr, "__zynth_reportFrame", frameMs, layoutMs, overBudget, nodeCount)
      }
    }
    uiManager.addSurfaceFirstFrameListener(root.rootId) {
      startupMetrics.markFirstFramePresented()
      root.post {
        Choreographer.getInstance().postFrameCallback {
          startupMetrics.markFirstInteractive()
        }
      }
    }
    installDefaultModules()
    installCrashHandler()
    ZynthNativeErrorOverlay.attach(this, root)
    ZynthNativePerformanceOverlay.attach(root)
  }

  private fun isStartupMetricsBootstrapEnabled(): Boolean {
    val rawStartupFlag = System.getProperty("ZYNTH_STARTUP_METRICS")?.trim()
    if (rawStartupFlag != null && parseBooleanLike(rawStartupFlag)) {
      return true
    }

    val rawCoreFeatures = System.getProperty("ZYNTH_CORE_FEATURES")?.trim()
    if (rawCoreFeatures.isNullOrEmpty()) {
      return false
    }

    val entries = rawCoreFeatures.split(',')
    for (entry in entries) {
      if (entry.trim() == "startupTime") {
        return true
      }
    }
    return false
  }

  private fun parseBooleanLike(value: String): Boolean {
    return value.equals("1") ||
      value.equals("true", ignoreCase = true) ||
      value.equals("yes", ignoreCase = true) ||
      value.equals("on", ignoreCase = true)
  }

  companion object {
    @Volatile private var crashHandlerInstalled = false

    @JvmStatic
    fun initialize(context: Context) {
      SoLoader.init(context, false)
    }
  }

  val rootSurfaceId: Int
    get() = root.rootId

  fun getUIManager(): ZynthUIManager {
    return uiManager
  }

  fun installDefaultModules() {
    startupMetrics.markModuleInitStart()
    DevtoolsModule.start(root.context)
    installModules(listOf(DevtoolsModule(root.context, this), FetchModule(this), CoreSystemModule(this)))
    startupMetrics.markModuleInitEnd()
  }

  private fun installCrashHandler() {
    if (crashHandlerInstalled) return
    crashHandlerInstalled = true
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      val message = throwable.message ?: "Uncaught exception"
      val stack = throwable.stackTraceToString()
      val event = JSONObject()
        .put("topic", "crash/java")
        .put("level", "error")
        .put("tag", "crash")
        .put("data", "$message\n$stack")
      val envelope = JSONObject()
        .put("type", "pub")
        .put("event", event)
      DevtoolsModule.emitNativeEvent(envelope.toString())
      previous?.uncaughtException(thread, throwable)
    }
  }

  fun installModules(modules: List<ZynthModule>) {
    for (module in modules) {
      startupMetrics.markModuleInitializeStart(module.name)
      registry.register(module)
      startupMetrics.markModuleInitializeEnd(module.name)
    }
  }

  fun setAssetProvider(provider: AssetProvider) {
    uiManager.assetProvider = provider
  }

  fun connectDevServer(url: String, token: String? = null) {
    connectDevServerInternal(url, token)
  }

  fun loadInitialBundle(assets: AssetManager, preloadedCode: String? = null, preloadedBytecode: ByteArray? = null) {
    val devServerUrl = if (preloadedCode == null && preloadedBytecode == null) {
      System.getProperty("ZYNTH_DEV_SERVER_URL")
    } else {
      null
    }

    val shouldDeferStartUntilBundleReady = devServerUrl.isNullOrBlank()

    synchronized(startupStateLock) {
      hasStarted = false
      pendingStartRootId = null
      isBundleLoaded = !shouldDeferStartUntilBundleReady
    }

    runOnJS {
      startupMetrics.markJsRuntimeSetupStart()
      JSBridge.installUIBindings(runtimePtr, uiManager)
      uiManager.bootstrapAxonEnvironment()
      registry.setSessionId(bridgeSessionId)
      JSBridge.installModuleRegistry(runtimePtr, registry)
      installHmrShim()
      startupMetrics.markJsRuntimeSetupEnd()

      val constants = registry.exportedConstants().toMutableMap()
      constants["bridgeSessionId"] = bridgeSessionId
      if (constants.isNotEmpty()) {
        val json = JSONObject(constants as Map<*, *>).toString()
        JSBridge.evaluateScript(runtimePtr, "globalThis.NativeConstants = $json;", "constants.js")
      }

      if (!devServerUrl.isNullOrBlank()) {
        dispatchPendingStartOnJSIfReady()
        return@runOnJS
      }

      if (preloadedBytecode != null) {
        startupMetrics.markHermesEvalStart()
        JSBridge.loadBytecode(runtimePtr, preloadedBytecode, "main.hbc")
        startupMetrics.markHermesEvalEnd()
      } else {
        startupMetrics.markBundleReadStart()
        val code = preloadedCode ?: run {
          try {
            assets.open("main.js").use { it.bufferedReader().readText() }
          } catch (error: Exception) {
            startupMetrics.markBundleReadEnd()
            return@runOnJS
          }
        }
        startupMetrics.markBundleReadEnd()
        startupMetrics.markHermesEvalStart()
        JSBridge.evaluateScript(runtimePtr, code, "main.js")
        startupMetrics.markHermesEvalEnd()
      }

      synchronized(startupStateLock) {
        isBundleLoaded = true
      }
      dispatchPendingStartOnJSIfReady()
    }
  }

  fun emitEvent(name: String, payload: Any?) {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return
    val payloadJson = when (payload) {
      null -> null
      is JSONObject -> payload.toString()
      is JSONArray -> payload.toString()
      else -> JSONObject.wrap(payload)?.toString()
    }
    runOnJS {
      runCatching {
        JSBridge.emitEvent(runtimePtr, trimmed, payloadJson)
      }
    }
  }

  fun registerSurface(rootView: ZynthRootView): Int {
    uiManager.registerSurface(rootView.rootId, rootView)
    return rootView.rootId
  }

  fun unregisterSurface(surfaceId: Int) {
    uiManager.unregisterSurface(surfaceId)
  }

  fun setActiveSurface(surfaceId: Int) {
    uiManager.setSurface(surfaceId)
  }

  fun flush() {
    uiManager.flush()
  }

  fun addSurfaceFirstFrameListener(surfaceId: Int, listener: () -> Unit) {
    uiManager.addSurfaceFirstFrameListener(surfaceId, listener)
  }

  fun start(rootId: Int) {
    var shouldDispatchStart = false
    if (hasStarted) {
      return
    }
    synchronized(startupStateLock) {
      if (hasStarted) {
        return
      }
      hasStarted = true
      pendingStartRootId = rootId
      shouldDispatchStart = isBundleLoaded
    }
    startupMetrics.markStartRequested()
    if (shouldDispatchStart) {
      runOnJS {
        dispatchPendingStartOnJSIfReady()
      }
    }
  }

  fun destroy() {
    ZynthHmrVisualIndicator.dismiss()
    stopPerformanceJsTicker()
    ZynthNativeErrorOverlay.detach()
    ZynthNativePerformanceOverlay.detach()
    runOnJSSync {
      JSBridge.destroyHermesRuntime(runtimePtr)
    }
    jsThread.quitSafely()
  }

  fun requestNativeOverlayReload() {
    runOnJS {
      runCatching {
        JSBridge.evaluateScript(
          runtimePtr,
          "(function(){var fn=globalThis.__zynth_rerenderApp; if (typeof fn==='function') fn();})();",
          "native-overlay-reload.js"
        )
      }
    }
  }

  fun setPerformanceOverlayEnabled(enabled: Boolean) {
    ZynthNativePerformanceOverlay.setPerformanceOverlayEnabled(enabled)
    if (enabled) {
      startPerformanceJsTicker()
    } else {
      stopPerformanceJsTicker()
    }
  }

  fun getPerformanceOverlayStats(): Map<String, Any> {
    return ZynthNativePerformanceOverlay.getPerformanceOverlaySnapshot()
  }

  internal fun evaluateScript(code: String, sourceUrl: String? = null) {
    runOnJSSync {
      JSBridge.evaluateScript(runtimePtr, code, sourceUrl)
    }
  }

  private fun runOnJS(block: () -> Unit) {
    if (Looper.myLooper() == jsHandler.looper) {
      block()
    } else {
      jsHandler.post(block)
    }
  }

  private fun runOnJSSync(block: () -> Unit) {
    if (Looper.myLooper() == jsHandler.looper) {
      block()
      return
    }
    val calledFromMain = Looper.myLooper() == Looper.getMainLooper()
    val latch = CountDownLatch(1)
    jsHandler.post {
      try {
        block()
      } finally {
        latch.countDown()
      }
    }
    if (!startupMetrics.isStartupTimeEnabled()) {
      latch.await()
      return
    }
    val waitStartMs = startupMetrics.nowMs()
    latch.await()
    val waitEndMs = startupMetrics.nowMs()
    startupMetrics.recordRunOnJSSyncWait(waitEndMs - waitStartMs, calledFromMain)
  }

  private fun dispatchPendingStartOnJSIfReady() {
    val rootId: Int? = synchronized(startupStateLock) {
      if (!isBundleLoaded) {
        null
      } else {
        val pending = pendingStartRootId
        pendingStartRootId = null
        pending
      }
    }
    if (rootId == null) return
    JSBridge.callGlobalDouble(runtimePtr, "__startApp", rootId.toDouble())
  }

  private fun startPerformanceJsTicker() {
    if (performanceJsTickerActive) return
    performanceJsTickerActive = true
    val ticker = object : Runnable {
      override fun run() {
        if (!performanceJsTickerActive) return
        if (ZynthNativePerformanceOverlay.requestPerformanceJsPing()) {
          runOnJS {
            ZynthNativePerformanceOverlay.recordPerformanceJsPing()
          }
        }
        jsHandler.postDelayed(this, 16L)
      }
    }
    performanceJsTicker = ticker
    jsHandler.post(ticker)
  }

  private fun stopPerformanceJsTicker() {
    performanceJsTickerActive = false
    val ticker = performanceJsTicker
    if (ticker != null) {
      jsHandler.removeCallbacks(ticker)
    }
    performanceJsTicker = null
  }

  internal fun handleDevMessage(payload: String) {
    handleDevMessageInternal(payload)
  }

  internal fun dispatchDevtoolsEvent(payload: String) {
    val escapedPayload = JSONObject.quote(payload)
    runOnJS {
      runCatching {
        JSBridge.evaluateScript(
          runtimePtr,
          "(function(){var fn=globalThis.__zynth_onDevtoolsEventRaw; if (typeof fn==='function') fn($escapedPayload);})();",
          "devtools-inbound.js"
        )
      }
    }
  }
}
