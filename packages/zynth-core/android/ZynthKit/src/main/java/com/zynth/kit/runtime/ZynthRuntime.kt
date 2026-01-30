package com.zynth.kit.runtime

import android.content.Context
import android.content.res.AssetManager
import com.facebook.soloader.SoLoader
import com.zynth.kit.core.AssetProvider
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.runtime.modules.DevtoolsModule
import com.zynth.kit.runtime.modules.FetchModule
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import java.util.concurrent.CountDownLatch
import org.json.JSONArray
import org.json.JSONObject

class ZynthRuntime(val root: ZynthRootView) {
  private val uiManager = ZynthUIManager(root)
  private val runtimePtr: Long = JSBridge.createHermesRuntime()
  private val registry = ZynthModuleRegistry()
  private val jsThread = HandlerThread("ZynthJS")
  private val jsHandler: Handler
  init {
    jsThread.start()
    jsHandler = Handler(jsThread.looper)
    uiManager.setJSHandler(jsHandler)
    uiManager.setFrameProfiler { frameMs, layoutMs, overBudget, nodeCount ->
      runOnJS {
        JSBridge.callGlobalFrame(runtimePtr, "__zynth_reportFrame", frameMs, layoutMs, overBudget, nodeCount)
      }
    }
    installDefaultModules()
    installCrashHandler()
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

  fun installDefaultModules() {
    DevtoolsModule.start(root.context)
    installModules(listOf(DevtoolsModule(root.context), FetchModule(this)))
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
      registry.register(module)
    }
  }

  fun setAssetProvider(provider: AssetProvider) {
    uiManager.assetProvider = provider
  }

  fun connectDevServer(url: String, token: String? = null) {
    // Phase 1 scaffold.
    url.length
    token?.length
  }

  fun loadInitialBundle(assets: AssetManager, preloadedCode: String? = null) {
    runOnJSSync {
      JSBridge.installUIBindings(runtimePtr, uiManager)
      JSBridge.installModuleRegistry(runtimePtr, registry)
    }

    val constants = registry.exportedConstants()
    if (constants.isNotEmpty()) {
      val json = JSONObject(constants as Map<*, *>).toString()
      runOnJSSync {
        JSBridge.evaluateScript(runtimePtr, "globalThis.NativeConstants = $json;", "constants.js")
      }
    }

    if (preloadedCode == null) {
      val devServerUrl = System.getProperty("ZYNTH_DEV_SERVER_URL")
      if (!devServerUrl.isNullOrBlank()) {
        return
      }
    }
    val code = preloadedCode ?: run {
      try {
        assets.open("main.js").use { it.bufferedReader().readText() }
      } catch (error: Exception) {
        return
      }
    }
    runOnJSSync {
      JSBridge.evaluateScript(runtimePtr, code, "main.js")
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
    // Phase 1 scaffold.
    surfaceId
    listener()
  }

  fun start(rootId: Int) {
    runOnJS {
      JSBridge.callGlobalDouble(runtimePtr, "__startApp", rootId.toDouble())
    }
  }

  fun destroy() {
    runOnJSSync {
      JSBridge.destroyHermesRuntime(runtimePtr)
    }
    jsThread.quitSafely()
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
    val latch = CountDownLatch(1)
    jsHandler.post {
      try {
        block()
      } finally {
        latch.countDown()
      }
    }
    latch.await()
  }
}
