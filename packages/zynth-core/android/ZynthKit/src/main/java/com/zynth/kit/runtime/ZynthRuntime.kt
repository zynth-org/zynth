package com.zynth.kit.runtime

import android.content.Context
import android.content.res.AssetManager
import android.util.Log
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.core.ZynthUIManager

class ZynthRuntime(private val root: ZynthRootView) {
  private val uiManager = ZynthUIManager()
  private val runtimePtr: Long = JSBridge.createHermesRuntime()

  companion object {
    @JvmStatic
    fun initialize(context: Context) {
      // Phase 1 scaffold.
      context.applicationContext
    }
  }

  fun installDefaultModules() {
    // Phase 1 scaffold.
  }

  fun installModules(modules: List<ZynthModule>) {
    // Phase 1 scaffold.
    modules.size
  }

  fun connectDevServer(url: String, token: String? = null) {
    // Phase 1 scaffold.
    url.length
    token?.length
  }

  fun loadInitialBundle(assets: AssetManager, preloadedCode: String? = null) {
    JSBridge.installUIBindings(runtimePtr, uiManager)
    if (preloadedCode == null) {
      val devServerUrl = System.getProperty("ZYNTH_DEV_SERVER_URL")
      if (!devServerUrl.isNullOrBlank()) {
        Log.d("ZynthRuntime", "Dev server configured; skipping asset bundle load.")
        return
      }
    }
    val code = preloadedCode ?: assets.open("main.js").use { it.bufferedReader().readText() }
    JSBridge.evaluateScript(runtimePtr, code, "main.js")
  }

  fun addSurfaceFirstFrameListener(surfaceId: Int, listener: () -> Unit) {
    // Phase 1 scaffold.
    surfaceId
    listener()
  }

  fun start(rootId: Int) {
    JSBridge.callGlobalDouble(runtimePtr, "__startApp", rootId.toDouble())
  }

  fun destroy() {
    JSBridge.destroyHermesRuntime(runtimePtr)
  }
}
