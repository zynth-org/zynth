package com.rune.kit.runtime

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.rune.kit.core.RuneRootView
import com.rune.kit.dev.RuneDevClient
import com.rune.kit.dev.RuneDevBundle
import com.rune.kit.dev.RuneDevBundleFetcher
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import kotlin.jvm.Volatile

private const val TAG = "RuneRuntime"

/**
 * Dev-only extension properties and methods for RuneRuntime.
 * This file is only included in DEBUG builds via the debug source set.
 */

// ============================================================================
// Dev-Only Properties (stored as internal properties for extension access)
// ============================================================================

internal val RuneRuntime.discoveryExecutor: ExecutorService
  get() = getOrCreateProperty("discoveryExecutor") {
    Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "RuneDevDiscovery").apply { isDaemon = true }
    }
  }

internal val RuneRuntime.discoveryClient: OkHttpClient
  get() = getOrCreateProperty("discoveryClient") {
    OkHttpClient.Builder()
      .connectTimeout(1, TimeUnit.SECONDS)
      .readTimeout(1, TimeUnit.SECONDS)
      .build()
  }

internal val RuneRuntime.bundleExecutor: ExecutorService
  get() = getOrCreateProperty("bundleExecutor") {
    Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "RuneBundleFetcher").apply { isDaemon = true }
    }
  }

internal val RuneRuntime.bundleRetryHandler: Handler
  get() = getOrCreateProperty("bundleRetryHandler") {
    Handler(Looper.getMainLooper())
  }

internal var RuneRuntime.pendingRetry: Boolean
  get() = getProperty("pendingRetry") as? Boolean ?: false
  set(value) = setProperty("pendingRetry", value)

internal var RuneRuntime.bundleRetryCount: Int
  get() = getProperty("bundleRetryCount") as? Int ?: 0
  set(value) = setProperty("bundleRetryCount", value)

internal var RuneRuntime.isLoadingBundle: Boolean
  get() = getProperty("isLoadingBundle") as? Boolean ?: false
  set(value) = setProperty("isLoadingBundle", value)

internal val RuneRuntime.devClient: RuneDevClient
  get() = getOrCreateProperty("devClient") { RuneDevClient(this) }

internal var RuneRuntime.devServerUrl: String?
  get() = getProperty("devServerUrl") as? String
  set(value) = setProperty("devServerUrl", value)

internal var RuneRuntime.isConnectingToDevServer: Boolean
  get() = getProperty("isConnectingToDevServer") as? Boolean ?: false
  set(value) = setProperty("isConnectingToDevServer", value)

internal var RuneRuntime.lastDevBundle: RuneDevBundle?
  get() = getProperty("lastDevBundle") as? RuneDevBundle
  set(value) = setProperty("lastDevBundle", value)

internal var RuneRuntime.hasSuccessfulDevBundle: Boolean
  get() = getProperty("hasSuccessfulDevBundle") as? Boolean ?: false
  set(value) = setProperty("hasSuccessfulDevBundle", value)

internal val RuneRuntime.statusBar: RuneDevStatusBar
  get() = getOrCreateProperty("statusBar") { RuneDevStatusBar(root) }

// Helper extension functions for property storage
private val devProperties = mutableMapOf<RuneRuntime, MutableMap<String, Any>>()

private fun RuneRuntime.getProperty(key: String): Any? {
  return devProperties[this]?.get(key)
}

private fun RuneRuntime.setProperty(key: String, value: Any?) {
  val props = devProperties.getOrPut(this) { mutableMapOf() }
  if (value == null) {
    props.remove(key)
  } else {
    props[key] = value
  }
}

private fun <T : Any> RuneRuntime.getOrCreateProperty(key: String, factory: () -> T): T {
  val props = devProperties.getOrPut(this) { mutableMapOf() }
  val existing = props[key]
  if (existing != null) {
    @Suppress("UNCHECKED_CAST")
    return existing as T
  }
  val newValue = factory()
  props[key] = newValue
  return newValue
}

// ============================================================================
// Dev Server Configuration
// ============================================================================

/**
 * Configures dev server support during runtime initialization.
 * Called from RuneRuntime.init in DEBUG builds only.
 */
// ============================================================================
// Public API Implementations
// ============================================================================
// These are the ONLY public dev methods. They are called from the main
// RuneRuntime class wrappers.

internal fun RuneRuntime.connectDevServerInternal(url: String) {
  // Prevent multiple concurrent connections
  synchronized(this) {
    if (isConnectingToDevServer || devServerUrl == url) {
      Log.d(TAG, "Already connecting/connected to $url, skipping duplicate connection")
      return
    }
    isConnectingToDevServer = true
  }
  
  devServerUrl = url
  installDevServerGlobal(url)
  devClient.connect(url)
  
  // Only fetch bundle if not already loading and no bundle exists
  if (!isLoadingBundle && lastDevBundle == null) {
    refreshDevBundleInternal()
  } else {
    Log.d(TAG, "Bundle already loading or exists, skipping refresh on connect")
  }
  
  isConnectingToDevServer = false
}

internal fun RuneRuntime.refreshDevBundleInternal() {
  Log.d(TAG, "refreshDevBundle invoked")
  
  // Prevent multiple simultaneous refresh attempts
  synchronized(this) {
    if (pendingRetry) {
      Log.d(TAG, "Refresh already pending, skipping")
      return
    }
  }
  
  root.post { statusBar.showUpdating() }
  if (loadDevBundleIfAvailable()) {
    restartAfterReload()
  } else {
    root.post { statusBar.showError("Reload Failed") }
  }
}

internal fun RuneRuntime.handleDevMessageInternal(payload: String) {
  // Show update notification when HMR message received
  if (payload.contains("\"type\":\"update\"") || payload.contains("'type':'update'")) {
    root.post { statusBar.showUpdateAvailable() }
  }
  adapter.callGlobal("__rune_receiveHMRMessage", arrayOf(payload))
}

// ============================================================================
// Dev Server Configuration
// ============================================================================

internal fun RuneRuntime.configureDevServer() {
  devServerUrl = System.getenv("RUNE_DEV_SERVER_URL")?.takeUnless { it.isBlank() }
  
  devServerUrl?.let {
    installDevServerGlobal(it)
    Log.d(TAG, "Connecting to dev server at $it")
    connectDevServerInternal(it)
  }
  
  if (devServerUrl == null) {
    autoDiscoverDevServer()
  }
}

/**
 * Installs HMR shim into the JavaScript runtime.
 * Called during runtime configuration.
 */
fun RuneRuntime.installHmrShim() {
  adapter.evaluate(
    """
    if (typeof globalThis.__rune_receiveHMRMessage !== "function") {
      globalThis.__rune_receiveHMRMessage = function(payload) {
        try {
          if (typeof payload === "string") {
            payload = JSON.parse(payload);
          }
        } catch (error) {
          console.error('[Rune HMR] parse failed', error);
          return;
        }
        if (payload && typeof globalThis.__rune_refresh === 'function') {
          globalThis.__rune_refresh(payload);
        } else if (payload && typeof globalThis.__rune_requestFullReload === 'function') {
          globalThis.__rune_requestFullReload(payload);
        } else {
          console.warn('[Rune HMR] No refresh handler available', payload && payload.type);
        }
      };
    }
    if (typeof globalThis.__rune_refresh !== 'function') {
      globalThis.__rune_refresh = function(payload) {
        console.warn('[Rune HMR] Refresh invoked with no runtime listener', payload && payload.type);
      };
    }
    """.trimIndent()
  )
}

/**
 * Disconnects from dev server and cleans up dev resources.
 * Called from RuneRuntime.destroy() in DEBUG builds only.
 */
fun RuneRuntime.disconnectDevServer() {
  devClient.disconnect()
  discoveryExecutor.shutdownNow()
  bundleExecutor.shutdownNow()
  bundleRetryHandler.removeCallbacksAndMessages(null)
  pendingRetry = false
  bundleRetryCount = 0
  devProperties.remove(this)
}

// ============================================================================
// Dev Server Connection Helpers
// ============================================================================

internal fun RuneRuntime.installDevServerGlobal(url: String) {
  val escaped = url.replace("\\", "\\\\").replace("\"", "\\\"")
  adapter.evaluate("globalThis.__RUNE_DEV_SERVER_URL = \"$escaped\";")
}

/**
 * Restores dev server URL after runtime reset (called from reloadJavaScript).
 */
internal fun RuneRuntime.restoreDevServerUrl() {
  devServerUrl?.let { installDevServerGlobal(it) }
}

private fun RuneRuntime.autoDiscoverDevServer() {
  discoveryExecutor.execute {
    val hosts = listOf("10.0.2.2", "127.0.0.1", "localhost")
    val ports = 8081..8085
    for (host in hosts) {
      for (port in ports) {
        if (Thread.currentThread().isInterrupted) {
          return@execute
        }
        // Stop discovery if dev server is already set
        if (devServerUrl != null || isConnectingToDevServer) {
          Log.d(TAG, "Dev server already configured, stopping discovery")
          return@execute
        }
        val baseUrl = "http://$host:$port"
        if (probeDevServer(baseUrl)) {
          Log.d(TAG, "Auto-discovered dev server at $baseUrl")
          connectDevServerInternal(baseUrl)
          return@execute
        }
      }
    }
    Log.d(TAG, "No dev server detected on default hosts/ports")
  }
}

private fun RuneRuntime.probeDevServer(baseUrl: String): Boolean {
  return try {
    val request = Request.Builder()
      .url("$baseUrl/health")
      .get()
      .build()
    discoveryClient.newCall(request).execute().use { response ->
      response.isSuccessful
    }
  } catch (e: Exception) {
    false
  }
}

// ============================================================================
// Dev Bundle Loading
// ============================================================================

/**
 * Attempts to load a JavaScript bundle from the dev server.
 */
fun RuneRuntime.loadDevBundleIfAvailable(): Boolean {
  val devUrl = devServerUrl ?: return false

  // Mark that we're loading to prevent concurrent loads
  synchronized(this) {
    if (isLoadingBundle) {
      Log.d(TAG, "Bundle load already in progress")
      return false
    }
    isLoadingBundle = true
  }

  try {
    if (lastDevBundle == null && !hasSuccessfulDevBundle) {
      root.post { statusBar.showBundleLoading() }
    }

    val bundle = fetchDevBundle(devUrl)
    Log.d(TAG, "Loaded dev bundle from ${bundle.url}")
    evaluateDevBundle(bundle)
    return true
  } catch (t: Throwable) {
    val message = "Dev bundle fetch failed: ${t.message ?: t::class.java.simpleName}"
    Log.w(TAG, message)
    val hasPriorSuccess = hasSuccessfulDevBundle
    
    if (hasPriorSuccess) {
      // If we've had success before, show error and use cache
      root.post { statusBar.showError("Bundle Load Failed") }
      root.showRedBox("Dev Bundle Error", message)
      lastDevBundle?.let {
        Log.d(TAG, "Using cached dev bundle")
        evaluateDevBundle(it)
        return true
      }
    } else {
      // First-time load failed, retry
      Log.d(TAG, "Initial bundle load failed, will retry")
      root.post { statusBar.showBundleLoading() }
      scheduleDevBundleRetry()
    }
    return false
  } finally {
    isLoadingBundle = false
  }
}

private fun RuneRuntime.fetchDevBundle(devUrl: String): RuneDevBundle {
  return if (Looper.myLooper() == Looper.getMainLooper()) {
    val future: Future<RuneDevBundle> = bundleExecutor.submit<RuneDevBundle> {
      RuneDevBundleFetcher.fetch(devUrl)
    }
    try {
      future.get()
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      throw e
    } catch (e: ExecutionException) {
      val cause = e.cause
      if (cause is Exception) throw cause
      throw e
    }
  } else {
    RuneDevBundleFetcher.fetch(devUrl)
  }
}

private fun RuneRuntime.evaluateDevBundle(bundle: RuneDevBundle) {
  val shouldReset = lastDevBundle != null || manager.hasRenderableContent()
  
  lastDevBundle = bundle
  hasSuccessfulDevBundle = true
  pendingRetry = false
  bundleRetryCount = 0  // Reset retry counter on success
  
  if (shouldReset) {
    reloadJavaScript(bundle.code)
  } else {
    load(bundle.code)
  }
  
  root.post { statusBar.showBundleLoaded() }
}

private fun RuneRuntime.scheduleDevBundleRetry() {
  if (pendingRetry) {
    return
  }
  
  // Max 5 retries to prevent infinite loops
  if (bundleRetryCount >= 5) {
    Log.w(TAG, "Max bundle retry attempts reached, giving up")
    root.post { 
      statusBar.showError("Dev Server Unavailable")
      statusBar.hide()
    }
    return
  }
  
  bundleRetryCount++
  pendingRetry = true
  val delay = 1500L + (bundleRetryCount * 500L)  // Increasing delay
  Log.d(TAG, "Scheduling bundle retry #$bundleRetryCount in ${delay}ms")
  
  bundleRetryHandler.postDelayed({
    pendingRetry = false
    refreshDevBundleInternal()
  }, delay)
}

private fun RuneRuntime.restartAfterReload() {
  val rootId = lastRootId
  if (rootId == null) {
    Log.d(TAG, "No rootId set yet, cannot restart")
    return
  }
  Log.d(TAG, "Restarting app after dev reload rootId=$rootId")
  adapter.callGlobalAsync("__startApp", arrayOf(rootId))
}
