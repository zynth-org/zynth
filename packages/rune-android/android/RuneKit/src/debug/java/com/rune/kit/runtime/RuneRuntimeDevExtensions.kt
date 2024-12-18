package com.rune.kit.runtime

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.rune.kit.core.RuneRootView
import com.rune.kit.dev.RuneDevBundle
import com.rune.kit.dev.RuneDevBundleFetcher
import com.rune.kit.dev.RuneDevClient
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import kotlin.jvm.Volatile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.charset.Charset

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

internal val RuneRuntime.hotUpdateClient: OkHttpClient
  get() = getOrCreateProperty("hotUpdateClient") {
    OkHttpClient.Builder()
      .retryOnConnectionFailure(true)
      .build()
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

internal var RuneRuntime.devServerToken: String?
  get() = getProperty("devServerToken") as? String
  set(value) = setProperty("devServerToken", value)

internal var RuneRuntime.latestDevHash: String?
  get() = getProperty("latestDevHash") as? String
  set(value) = setProperty("latestDevHash", value)

internal var RuneRuntime.lastAppliedDevHash: String?
  get() = getProperty("lastAppliedDevHash") as? String
  set(value) = setProperty("lastAppliedDevHash", value)

internal var RuneRuntime.isApplyingHotUpdate: Boolean
  get() = (getProperty("isApplyingHotUpdate") as? Boolean) ?: false
  set(value) = setProperty("isApplyingHotUpdate", value)

internal var RuneRuntime.isConnectingToDevServer: Boolean
  get() = getProperty("isConnectingToDevServer") as? Boolean ?: false
  set(value) = setProperty("isConnectingToDevServer", value)

internal var RuneRuntime.lastDevBundle: RuneDevBundle?
  get() = getProperty("lastDevBundle") as? RuneDevBundle
  set(value) = setProperty("lastDevBundle", value)

internal var RuneRuntime.hasSuccessfulDevBundle: Boolean
  get() = getProperty("hasSuccessfulDevBundle") as? Boolean ?: false
  set(value) = setProperty("hasSuccessfulDevBundle", value)

internal var RuneRuntime.devRuntimeName: String
  get() = (getProperty("devRuntimeName") as? String)?.takeIf { it.isNotBlank() } ?: "app"
  set(value) = setProperty("devRuntimeName", value)

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

internal fun RuneRuntime.connectDevServerInternal(url: String, token: String? = null) {
  val sanitizedToken = sanitizeToken(token)
  Log.d(
    TAG,
    "connectDevServerInternal url=$url tokenPresent=${sanitizedToken != null} tokenPrefix=" +
      sanitizedToken?.take(8)
  )

  synchronized(this) {
    if (isConnectingToDevServer) {
      Log.d(TAG, "Already connecting to dev server, skipping duplicate request")
      return
    }
    isConnectingToDevServer = true
  }

  devServerUrl = url
  devServerToken = sanitizedToken
  installDevServerGlobal(url, sanitizedToken)
  devClient.connect(url, sanitizedToken)
  
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

internal fun RuneRuntime.applyHotUpdate() {
  val baseUrl = devServerUrl
  if (baseUrl.isNullOrEmpty()) {
    Log.w(TAG, "Hot update requested without dev server URL; falling back to full reload")
    root.post { refreshDevBundleInternal() }
    return
  }

  if (isApplyingHotUpdate) {
    Log.d(TAG, "Hot update already in progress; skipping re-entrant call")
    return
  }

  isApplyingHotUpdate = true
  root.post { statusBar.showUpdating() }

  bundleExecutor.execute {
    try {
      val manifestCandidates = buildManifestCandidatePaths()
      if (manifestCandidates.isEmpty()) {
        throw IllegalStateException("No manifest candidates available")
      }

      var manifest: JSONObject? = null
      var manifestSourcePath: String? = null
      var manifestHash: String? = null

      for (candidate in manifestCandidates) {
        val manifestUrl = buildDevResourceUrl(candidate)
        if (manifestUrl == null) {
          Log.w(TAG, "Skipping manifest candidate with unresolved URL: $candidate")
          continue
        }
        Log.d(TAG, "Fetching hot-update manifest $manifestUrl")
        try {
          val manifestJson = fetchHotUpdateResource(manifestUrl)
            ?: throw IllegalStateException("Manifest fetch returned empty body")
          manifest = JSONObject(manifestJson)
          manifestSourcePath = candidate
          manifestHash = manifest.optString("h").takeIf { !it.isNullOrBlank() }
          manifestHash?.let { latestDevHash = it }
          manifest?.optString("name")?.takeIf { it.isNotBlank() }?.let { runtimeName ->
            devRuntimeName = runtimeName
          }
          break
        } catch (error: Throwable) {
          Log.w(TAG, "Manifest fetch failed for $manifestUrl: ${error.message}")
        }
      }

      val resolvedManifest = manifest
        ?: throw IllegalStateException("Unable to load hot-update manifest from candidates: $manifestCandidates")

      val chunkIds = when (val chunks = resolvedManifest.opt("c")) {
        is JSONArray -> (0 until chunks.length()).mapNotNull { chunks.optString(it, null) }
        is JSONObject -> chunks.keys().asSequence().toList()
        else -> emptyList()
      }
      if (chunkIds.isEmpty()) {
        throw IllegalStateException("Manifest missing chunk list: $resolvedManifest")
      }

      val manifestHashFromPath = manifestSourcePath?.let { manifestHashFromPath(it) }
      val scripts = mutableListOf<Pair<String, String>>()

      for (chunkId in chunkIds) {
        val chunkCandidates = buildChunkCandidatePaths(chunkId, manifestHashFromPath, manifestHash)
        var chunkCode: String? = null
        for (candidate in chunkCandidates) {
          val chunkUrl = buildDevResourceUrl(candidate)
          if (chunkUrl == null) {
            Log.w(TAG, "Skipping chunk candidate with unresolved URL: $candidate")
            continue
          }
          Log.d(TAG, "Fetching hot-update chunk $chunkUrl")
          try {
            chunkCode = fetchHotUpdateResource(chunkUrl)
            if (chunkCode != null) {
              break
            }
          } catch (error: Throwable) {
            Log.w(TAG, "Chunk fetch failed for $chunkUrl: ${error.message}")
          }
        }

        if (chunkCode.isNullOrEmpty()) {
          throw IllegalStateException("Hot-update chunk $chunkId unavailable (candidates: $chunkCandidates)")
        }
        scripts += chunkId to chunkCode
      }

      var hadFailure = false
      scripts.forEach { (chunkId, code) ->
        Log.d(TAG, "Executing hot-update chunk $chunkId (${code.length} chars)")
        val preview = code.take(200).replace("\n", "\\n")
        Log.d(TAG, "Chunk $chunkId preview: $preview")
        try {
          adapter.evaluate(code)
          Log.d(TAG, "Chunk $chunkId executed successfully")
        } catch (executeError: Throwable) {
          hadFailure = true
          Log.e(TAG, "Chunk $chunkId execution failed: ${executeError.message}", executeError)
        }
      }

      if (hadFailure) {
        root.post {
          statusBar.showError("Hot Update Failed")
          refreshDevBundleInternal()
        }
      } else {
        lastAppliedDevHash = manifestHash?.takeIf { it.isNotBlank() } ?: latestDevHash
        root.post {
          statusBar.showBundleLoaded()
          Log.d(TAG, "Hot update applied successfully")
        }
      }
    } catch (t: Throwable) {
      Log.w(TAG, "Hot update failed: ${t.message}", t)
      root.post {
        statusBar.showError("Hot Update Failed")
        refreshDevBundleInternal()
      }
    } finally {
      isApplyingHotUpdate = false
    }
  }
}

private fun RuneRuntime.buildManifestCandidatePaths(): List<String> {
  val runtimeName = devRuntimeName.ifBlank { "app" }
  val seen = LinkedHashSet<String>()
  val hashSources = buildList {
    latestDevHash?.takeIf { it.isNotBlank() }?.let { add(it) }
    lastAppliedDevHash?.takeIf { it.isNotBlank() && it != latestDevHash }?.let { add(it) }
  }

  for (hash in hashSources) {
    seen.add("/bundle/$runtimeName.$hash.hot-update.json")
  }

  seen.add("/bundle/$runtimeName.hot-update.json")

  if (!runtimeName.equals("app", ignoreCase = true)) {
    for (hash in hashSources) {
      seen.add("/bundle/app.$hash.hot-update.json")
    }
    seen.add("/bundle/app.hot-update.json")
  }

  return seen.toList()
}

private fun RuneRuntime.buildChunkCandidatePaths(
  chunkId: String,
  manifestPathHash: String?,
  manifestHashField: String?
): List<String> {
  val seen = LinkedHashSet<String>()
  val hashSources = buildList {
    manifestHashField?.takeIf { it.isNotBlank() }?.let { add(it) }
    latestDevHash?.takeIf { it.isNotBlank() && it != manifestHashField }?.let { add(it) }
    manifestPathHash?.takeIf { it.isNotBlank() && it != manifestHashField && it != latestDevHash }?.let { add(it) }
    lastAppliedDevHash?.takeIf {
      it.isNotBlank() && it != manifestHashField && it != latestDevHash && it != manifestPathHash
    }?.let { add(it) }
  }

  for (hash in hashSources) {
    seen.add("/bundle/$chunkId.$hash.hot-update.js")
  }

  seen.add("/bundle/$chunkId.hot-update.js")

  return seen.toList()
}

private fun manifestHashFromPath(relativePath: String): String? {
  val name = relativePath.substringAfterLast('/')
  val suffix = ".hot-update.json"
  if (!name.endsWith(suffix)) {
    return null
  }
  val withoutSuffix = name.removeSuffix(suffix)
  val hash = withoutSuffix.substringAfterLast('.', missingDelimiterValue = "")
  return hash.takeIf { it.isNotBlank() && it != withoutSuffix }
}

private fun RuneRuntime.fetchHotUpdateResource(url: HttpUrl): String? {
  val request = Request.Builder()
    .url(url)
    .header("Cache-Control", "no-cache")
    .build()
  return hotUpdateClient.newCall(request).execute().use { response ->
    if (!response.isSuccessful) {
      throw IllegalStateException("Request $url failed with ${response.code}")
    }
    response.body?.string()
  }
}

private fun RuneRuntime.buildDevResourceUrl(path: String): HttpUrl? {
  val base = devServerUrl?.toHttpUrlOrNull() ?: return null
  val builder = base.newBuilder()
    .encodedPath(ensureLeadingSlash(path))
  sanitizeToken(devServerToken)?.let { token ->
    builder.removeAllQueryParameters("token")
    builder.addQueryParameter("token", token)
  }
  return builder.build()
}

private fun ensureLeadingSlash(path: String): String {
  return if (path.startsWith('/')) path else "/$path"
}

private fun sanitizeToken(token: String?): String? {
  val trimmed = token?.trim()
  return if (trimmed.isNullOrEmpty()) null else trimmed
}

private fun RuneRuntime.loadPersistedDevServerConfig(): Pair<String?, String?>? {
  val context = root.context ?: return null
  return runCatching {
    val runeDir = File(context.filesDir, ".rune")
    val configFile = File(runeDir, "dev-server.json")
    if (!configFile.exists()) {
      return loadDevServerConfigFromAssets(context)
    }
    val raw = configFile.readText(Charset.forName("UTF-8"))
    val json = JSONObject(raw)
    val urlValue = json.optString("url", "")
    val tokenValue = json.optString("token", "")
    val url = urlValue.takeIf { it.isNotBlank() }
    val token = tokenValue.takeIf { it.isNotBlank() }
    url to token
  }.getOrElse { error ->
    Log.w(TAG, "Failed to load persisted dev config: ${error.message}", error)
    loadDevServerConfigFromAssets(context)
  }
}

private fun loadDevServerConfigFromAssets(context: android.content.Context): Pair<String?, String?>? {
  return runCatching {
    context.assets.open("rune-dev-config.json").bufferedReader().use { reader ->
      val raw = reader.readText()
      val json = JSONObject(raw)
      val url = json.optString("url", "").takeIf { it.isNotBlank() }
      val token = json.optString("token", "").takeIf { it.isNotBlank() }
      url to token
    }
  }.getOrNull()
}

internal fun RuneRuntime.handleDevMessageInternal(payload: String) {
  val json = try {
    JSONObject(payload)
  } catch (_: Throwable) {
    adapter.callGlobal("__rune_receiveHMRMessage", arrayOf(payload))
    return
  }

  val type = json.optString("type", "")
  when (type) {
    "update" -> {
      Log.d(TAG, "Received hot update message")
      root.post { statusBar.showUpdateAvailable() }
      applyHotUpdate()
    }

    "hash" -> {
      val hash = json.optString("data", "")
      if (hash.isNotBlank()) {
        latestDevHash = hash
        Log.d(TAG, "Updated compilation hash $hash")
      }
    }

    "ok", "still-ok", "built", "sync" -> handleCompilationSuccess(type)

    "warnings" -> {
      val warnings = json.optJSONArray("data")
      if (warnings != null && warnings.length() > 0) {
        Log.w(TAG, "Compilation warnings (${warnings.length()})")
        for (index in 0 until warnings.length()) {
          val warning = warnings.optJSONObject(index)
          val message = warning?.optString("message") ?: continue
          Log.w(TAG, "  • $message")
        }
      } else {
        Log.w(TAG, "Compilation warnings received with no payload")
      }
    }

    "errors" -> {
      val errors = json.optJSONArray("data")
      if (errors != null && errors.length() > 0) {
        Log.e(TAG, "Compilation errors (${errors.length()})")
        for (index in 0 until errors.length()) {
          val error = errors.optJSONObject(index)
          val message = error?.optString("message") ?: continue
          Log.e(TAG, "  • $message")
        }
      } else {
        Log.e(TAG, "Compilation errors received with no payload")
      }
      val primaryError = errors?.optJSONObject(0)?.optString("message")
      root.post {
        statusBar.showError("Build Failed")
        root.showRedBox(primaryError ?: "Compilation Failed", null)
      }
    }

    else -> {
      if (type.isNotBlank()) {
        Log.d(TAG, "Forwarding dev message type '$type' to JS runtime")
      }
    }
  }

  adapter.callGlobal("__rune_receiveHMRMessage", arrayOf(payload))
}

private fun RuneRuntime.handleCompilationSuccess(trigger: String) {
  if (isApplyingHotUpdate) {
    Log.d(TAG, "Ignoring $trigger message while hot update is in progress")
    return
  }

  val url = devServerUrl
  if (url.isNullOrEmpty()) {
    Log.d(TAG, "Received $trigger without dev server URL; skipping")
    return
  }

  if (lastDevBundle == null) {
    Log.d(TAG, "Received $trigger before initial dev bundle; waiting for first load")
    return
  }

  val hash = latestDevHash
  if (hash.isNullOrBlank()) {
    Log.d(TAG, "Received $trigger without hash; performing full reload")
    root.post { refreshDevBundleInternal() }
    return
  }

  val appliedHash = lastAppliedDevHash
  if (appliedHash == null) {
    Log.d(TAG, "Recording initial hash $hash from $trigger message")
    lastAppliedDevHash = hash
    return
  }

  if (appliedHash == hash) {
    Log.d(TAG, "Hash $hash already applied; ignoring $trigger message")
    return
  }

  Log.d(TAG, "Triggering hot update after $trigger message (hash: $hash)")
  root.post { statusBar.showUpdateAvailable() }
  applyHotUpdate()
}

// ============================================================================
// Dev Server Configuration
// ============================================================================

internal fun RuneRuntime.configureDevServer() {
  var configured = false

  System.getenv("RUNE_DEV_RUNTIME")
    ?.trim()
    ?.takeIf { it.isNotEmpty() }
    ?.let { devRuntimeName = it }

  loadPersistedDevServerConfig()?.let { (url, token) ->
    val actualUrl = url?.takeIf { it.isNotBlank() }
    if (actualUrl != null) {
      val actualToken = sanitizeToken(token)
      Log.d(
        TAG,
        "Loaded persisted dev config url=$actualUrl tokenPresent=${actualToken != null}"
      )
      devServerUrl = actualUrl
      devServerToken = actualToken
      installDevServerGlobal(actualUrl, actualToken)
      connectDevServerInternal(actualUrl, actualToken)
      configured = true
    }
  }

  if (!configured) {
    val envUrl = System.getenv("RUNE_DEV_SERVER_URL")?.takeUnless { it.isBlank() }
    val envToken = sanitizeToken(System.getenv("RUNE_DEV_SERVER_TOKEN"))

    devServerUrl = envUrl
    devServerToken = envToken

    envUrl?.let {
      installDevServerGlobal(it, envToken)
      Log.d(TAG, "Connecting to dev server at $it")
      connectDevServerInternal(it, envToken)
      configured = true
    }
  }

  if (!configured) {
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
      Object.defineProperty(globalThis.__rune_refresh, '__isRuneDefaultStub', {
        value: true,
        configurable: true,
        enumerable: false,
        writable: false,
      });
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

internal fun RuneRuntime.installDevServerGlobal(url: String, token: String?) {
  val escaped = url.replace("\\", "\\\\").replace("\"", "\\\"")
  adapter.evaluate("globalThis.__RUNE_DEV_SERVER_URL = \"$escaped\";")
  val sanitizedToken = sanitizeToken(token)
  if (sanitizedToken != null) {
    val escapedToken = sanitizedToken.replace("\\", "\\\\").replace("\"", "\\\"")
    adapter.evaluate("globalThis.__RUNE_DEV_SERVER_TOKEN = \"$escapedToken\";")
  } else {
    adapter.evaluate("delete globalThis.__RUNE_DEV_SERVER_TOKEN;")
  }
}

/**
 * Restores dev server URL after runtime reset (called from reloadJavaScript).
 */
internal fun RuneRuntime.restoreDevServerUrl() {
  devServerUrl?.let { installDevServerGlobal(it, devServerToken) }
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
      RuneDevBundleFetcher.fetch(devUrl, devServerToken)
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
    RuneDevBundleFetcher.fetch(devUrl, devServerToken)
  }
}

private fun RuneRuntime.evaluateDevBundle(bundle: RuneDevBundle) {
  val shouldReset = lastDevBundle != null || manager.hasRenderableContent()
  
  lastDevBundle = bundle
  hasSuccessfulDevBundle = true
  pendingRetry = false
  bundleRetryCount = 0  // Reset retry counter on success
  lastAppliedDevHash = latestDevHash?.takeIf { it.isNotBlank() }
  
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
