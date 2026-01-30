package com.zynth.kit.runtime

import android.util.Log
import com.zynth.kit.dev.ZynthDevClient
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "ZynthRuntimeHMR"

internal val ZynthRuntime.hotUpdateExecutor: ExecutorService
  get() = getOrCreateProperty("hotUpdateExecutor") {
    Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "ZynthHotUpdate").apply { isDaemon = true }
    }
  }

internal val ZynthRuntime.hotUpdateClient: OkHttpClient
  get() = getOrCreateProperty("hotUpdateClient") {
    OkHttpClient.Builder()
      .retryOnConnectionFailure(true)
      .build()
  }

internal val ZynthRuntime.devClient: ZynthDevClient
  get() = getOrCreateProperty("devClient") { ZynthDevClient(this) }

internal var ZynthRuntime.devServerUrl: String?
  get() = getProperty("devServerUrl") as? String
  set(value) = setProperty("devServerUrl", value)

internal var ZynthRuntime.devServerToken: String?
  get() = getProperty("devServerToken") as? String
  set(value) = setProperty("devServerToken", value)

internal var ZynthRuntime.latestDevHash: String?
  get() = getProperty("latestDevHash") as? String
  set(value) = setProperty("latestDevHash", value)

internal var ZynthRuntime.lastAppliedDevHash: String?
  get() = getProperty("lastAppliedDevHash") as? String
  set(value) = setProperty("lastAppliedDevHash", value)

internal var ZynthRuntime.isApplyingHotUpdate: Boolean
  get() = (getProperty("isApplyingHotUpdate") as? Boolean) ?: false
  set(value) = setProperty("isApplyingHotUpdate", value)

internal var ZynthRuntime.devRuntimeName: String
  get() = (getProperty("devRuntimeName") as? String)?.takeIf { it.isNotBlank() } ?: "app"
  set(value) = setProperty("devRuntimeName", value)

private val devProperties = mutableMapOf<ZynthRuntime, MutableMap<String, Any>>()

private fun ZynthRuntime.getProperty(key: String): Any? {
  return devProperties[this]?.get(key)
}

private fun ZynthRuntime.setProperty(key: String, value: Any?) {
  val props = devProperties.getOrPut(this) { mutableMapOf() }
  if (value == null) {
    props.remove(key)
  } else {
    props[key] = value
  }
}

private fun <T : Any> ZynthRuntime.getOrCreateProperty(key: String, factory: () -> T): T {
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

internal fun ZynthRuntime.connectDevServerInternal(url: String, token: String? = null) {
  val sanitizedToken = sanitizeToken(token)
  devServerUrl = url
  devServerToken = sanitizedToken
  installDevServerGlobal(url, sanitizedToken)
  devClient.connect(url, sanitizedToken)
}

internal fun ZynthRuntime.handleDevMessageInternal(payload: String) {
  val json = try {
    JSONObject(payload)
  } catch (_: Throwable) {
    emitHmrPayloadToJS(payload)
    return
  }

  val type = json.optString("type", "")
  when (type) {
    "update" -> applyHotUpdate()
    "hash" -> {
      val hash = json.optString("data", "")
      if (hash.isNotBlank()) {
        latestDevHash = hash
      }
    }
    "ok", "still-ok", "built", "sync" -> handleCompilationSuccess(type)
  }

  emitHmrPayloadToJS(payload)
}

internal fun ZynthRuntime.installHmrShim() {
  val code =
    """
    if (typeof globalThis.__zynth_receiveHMRMessage !== "function") {
      globalThis.__zynth_receiveHMRMessage = function(payload) {
        try {
          if (typeof payload === "string") {
            payload = JSON.parse(payload);
          }
        } catch (error) {
          console.error('[Zynth HMR] parse failed', error);
          return;
        }
        if (payload && typeof globalThis.__zynth_refresh === 'function') {
          globalThis.__zynth_refresh(payload);
        } else if (payload && typeof globalThis.__zynth_requestFullReload === 'function') {
          globalThis.__zynth_requestFullReload(payload);
        } else {
          console.warn('[Zynth HMR] No refresh handler available', payload && payload.type);
        }
      };
    }
    if (typeof globalThis.__zynth_refresh !== 'function') {
      globalThis.__zynth_refresh = function(payload) {};
      Object.defineProperty(globalThis.__zynth_refresh, '__isZynthDefaultStub', {
        value: true,
        configurable: true,
        enumerable: false,
        writable: false,
      });
    }
    """.trimIndent()
  evaluateScript(code, "zynth-hmr-shim.js")
}

private fun ZynthRuntime.handleCompilationSuccess(trigger: String) {
  if (isApplyingHotUpdate) return
  val hash = latestDevHash
  if (hash.isNullOrBlank()) return
  if (lastAppliedDevHash == null) {
    lastAppliedDevHash = hash
    return
  }
  if (lastAppliedDevHash == hash) return
  applyHotUpdate()
}

internal fun ZynthRuntime.applyHotUpdate() {
  val baseUrl = devServerUrl
  if (baseUrl.isNullOrEmpty()) return
  if (isApplyingHotUpdate) return
  isApplyingHotUpdate = true

  hotUpdateExecutor.execute {
    try {
      val manifestCandidates = buildManifestCandidatePaths()
      var manifest: JSONObject? = null
      var manifestSourcePath: String? = null
      var manifestHash: String? = null

      for (candidate in manifestCandidates) {
        val manifestUrl = buildDevResourceUrl(candidate) ?: continue
        try {
          val manifestJson = fetchHotUpdateResource(manifestUrl)
            ?: throw IllegalStateException("Manifest fetch returned empty body")
          manifest = JSONObject(manifestJson)
          manifestSourcePath = candidate
          manifestHash = manifest.optString("h").takeIf { it.isNotBlank() }
          manifestHash?.let { latestDevHash = it }
          manifest.optString("name").takeIf { it.isNotBlank() }?.let { runtimeName ->
            devRuntimeName = runtimeName
          }
          break
        } catch (_: Throwable) {
        }
      }

      val resolvedManifest = manifest
        ?: throw IllegalStateException("Unable to load hot-update manifest")

      val chunkIds = when (val chunks = resolvedManifest.opt("c")) {
        is JSONArray -> (0 until chunks.length()).mapNotNull { chunks.optString(it, null) }
        is JSONObject -> chunks.keys().asSequence().toList()
        else -> emptyList()
      }
      if (chunkIds.isEmpty()) {
        throw IllegalStateException("Manifest missing chunk list")
      }

      val manifestHashFromPath = manifestSourcePath?.let { manifestHashFromPath(it) }
      val scripts = mutableListOf<Pair<String, String>>()

      for (chunkId in chunkIds) {
        val chunkCandidates = buildChunkCandidatePaths(chunkId, manifestHashFromPath, manifestHash)
        var chunkCode: String? = null
        for (candidate in chunkCandidates) {
          val chunkUrl = buildDevResourceUrl(candidate) ?: continue
          try {
            chunkCode = fetchHotUpdateResource(chunkUrl)
            if (chunkCode != null) break
          } catch (_: Throwable) {
          }
        }
        if (chunkCode.isNullOrEmpty()) {
          throw IllegalStateException("Hot-update chunk $chunkId unavailable")
        }
        scripts += chunkId to chunkCode
      }

      scripts.forEach { (chunkId, code) ->
        evaluateScript(code, "hot-update-$chunkId.js")
      }
      lastAppliedDevHash = manifestHash?.takeIf { it.isNotBlank() } ?: latestDevHash
    } catch (t: Throwable) {
      Log.w(TAG, "Hot update failed: ${t.message}")
    } finally {
      isApplyingHotUpdate = false
    }
  }
}

private fun ZynthRuntime.emitHmrPayloadToJS(payload: String) {
  val quoted = JSONObject.quote(payload)
  val code = "globalThis.__zynth_receiveHMRMessage && globalThis.__zynth_receiveHMRMessage($quoted);"
  evaluateScript(code, "zynth-hmr-message.js")
}

private fun ZynthRuntime.buildManifestCandidatePaths(): List<String> {
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

private fun ZynthRuntime.buildChunkCandidatePaths(
  chunkId: String,
  manifestPathHash: String?,
  manifestHashField: String?
): List<String> {
  val seen = LinkedHashSet<String>()
  val hashSources = buildList {
    manifestHashField?.takeIf { it.isNotBlank() }?.let { add(it) }
    latestDevHash?.takeIf { it.isNotBlank() && it != manifestHashField }?.let { add(it) }
    manifestPathHash?.takeIf { it.isNotBlank() && it != manifestHashField && it != latestDevHash }?.let {
      add(it)
    }
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
  if (!name.endsWith(suffix)) return null
  val withoutSuffix = name.removeSuffix(suffix)
  val hash = withoutSuffix.substringAfterLast('.', missingDelimiterValue = "")
  return hash.takeIf { it.isNotBlank() && it != withoutSuffix }
}

private fun ZynthRuntime.fetchHotUpdateResource(url: HttpUrl): String? {
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

private fun ZynthRuntime.buildDevResourceUrl(path: String): HttpUrl? {
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

internal fun ZynthRuntime.installDevServerGlobal(url: String, token: String?) {
  val escaped = url.replace("\\", "\\\\").replace("\"", "\\\"")
  evaluateScript("globalThis.__ZYNTH_DEV_SERVER_URL = \"$escaped\";", "zynth-dev-url.js")
  val sanitized = sanitizeToken(token)
  if (sanitized != null) {
    val escapedToken = sanitized.replace("\\", "\\\\").replace("\"", "\\\"")
    evaluateScript("globalThis.__ZYNTH_DEV_SERVER_TOKEN = \"$escapedToken\";", "zynth-dev-token.js")
  } else {
    evaluateScript("delete globalThis.__ZYNTH_DEV_SERVER_TOKEN;", "zynth-dev-token.js")
  }
}
