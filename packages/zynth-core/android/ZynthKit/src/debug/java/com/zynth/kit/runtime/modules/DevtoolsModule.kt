package com.zynth.kit.runtime.modules

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.util.Log
import com.zynth.kit.dev.ZynthDevtoolsClient
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthTypeException
import com.zynth.kit.runtime.ZynthNativeErrorOverlay
import java.io.File
import java.nio.charset.Charset
import org.json.JSONObject

class DevtoolsModule(
  private val context: Context,
  private val runtime: ZynthRuntime? = null
) : ZynthModule {
  override val name: String = "Devtools"

  override val exportedMethods: List<String> = listOf(
    "connect",
    "emit",
    "nativeError",
    "isConnected",
    "setPerformanceOverlayEnabled",
    "getPerformanceOverlayStats",
  )

  companion object {
    private const val TAG = "ZynthDevtools"
    private val client = ZynthDevtoolsClient()

    @JvmStatic
    fun start(context: Context) {
      val intentUrl = readIntentExtra(context, "ZYNTH_DEVTOOLS_URL")
      val intentToken = readIntentExtra(context, "ZYNTH_DEVTOOLS_TOKEN")
      if (!intentUrl.isNullOrBlank()) {
        Log.d(TAG, "Connecting via intent extras: $intentUrl")
        client.connect(intentUrl, intentToken)
        return
      }
      val envUrl = readSystemValue("ZYNTH_DEVTOOLS_URL")
      val envToken = readSystemValue("ZYNTH_DEVTOOLS_TOKEN")
      if (envUrl != null) {
        Log.d(TAG, "Connecting via system/env: $envUrl")
        client.connect(envUrl, envToken)
        return
      }
      loadPersistedDevtoolsConfig(context)?.let { (url, token) ->
        Log.d(TAG, "Connecting via persisted config: $url")
        client.connect(url, token)
        return
      }
      Log.w(TAG, "No devtools URL found; devtools disabled")
    }

    @JvmStatic
    fun setInboundSink(sink: ((String) -> Unit)?) {
      client.setInboundListener(sink)
    }

    @JvmStatic
    fun emitNativeEvent(eventJson: String?) {
      val raw = eventJson ?: return
      ZynthNativeErrorOverlay.handleRawEvent(raw)
      val event = runCatching { JSONObject(raw) }.getOrNull() ?: return
      if (!event.has("topic")) return
      val envelope = JSONObject()
        .put("type", "pub")
        .put("event", event)
      Log.d(TAG, "emitNativeEvent topic=${event.optString("topic")}")
      client.publish(envelope.toString())
    }

    @JvmStatic
    fun isConnected(): Boolean {
      return client.isConnected
    }

    // Crash helpers removed (test-only).

    private fun readSystemValue(key: String): String? {
      val prop = System.getProperty(key)
      if (!prop.isNullOrBlank()) return prop
      val env = System.getenv(key)
      return env?.takeIf { it.isNotBlank() }
    }

    private fun readIntentExtra(context: Context, key: String): String? {
      var current: Context? = context
      while (current is ContextWrapper) {
        if (current is Activity) {
          val value = current.intent?.getStringExtra(key)
          if (!value.isNullOrBlank()) return value
        }
        current = current.baseContext
      }
      return null
    }

    private fun loadPersistedDevtoolsConfig(context: Context): Pair<String, String?>? {
      return readConfigFile(File(context.filesDir, ".zynth/dev-server.json"))
        ?: readAssetConfig(context, "zynth-dev-config.json")
    }

    private fun readConfigFile(file: File): Pair<String, String?>? {
      if (!file.exists()) return null
      val raw = runCatching { file.readText(Charset.forName("UTF-8")) }.getOrNull()
        ?: return null
      return parseConfig(raw)
    }

    private fun readAssetConfig(context: Context, name: String): Pair<String, String?>? {
      return runCatching {
        context.assets.open(name).bufferedReader().use { reader ->
          parseConfig(reader.readText())
        }
      }.getOrNull()
    }

    private fun parseConfig(raw: String): Pair<String, String?>? {
      return runCatching {
        val json = JSONObject(raw)
        val url = json.optString("devtoolsUrl", "").takeIf { it.isNotBlank() }
          ?: return null
        val token = json.optString("devtoolsToken", "").takeIf { it.isNotBlank() }
        url to token
      }.getOrNull()
    }
  }

  override fun initialize() {
    start(context)
    val runtimeRef = runtime
    if (runtimeRef != null) {
      setInboundSink { payload ->
        runtimeRef.dispatchDevtoolsEvent(payload)
      }
    }
  }

  override fun invalidate() {
    setInboundSink(null)
    client.disconnect()
  }

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return when (method) {
      "connect" -> {
        val params = args.nestedAt(0)
        val url = params.getString("url")
        val token = params.getOptionalString("token")
        client.connect(url, token)
        ok()
      }
      "emit" -> {
        val eventMap = args.getMapAt(0)
        val event = JSONObject(eventMap)
        if (!event.has("topic")) {
          return error("missing_topic")
        }
        val envelope = JSONObject()
          .put("type", "pub")
          .put("event", event)
        ZynthNativeErrorOverlay.handleRawEvent(envelope.toString())
        client.publish(envelope.toString())
        ok()
      }
      "nativeError" -> {
        val params = args.nestedAt(0)
        val message = params.getString("message", "Devtools native error test")
        val event = JSONObject()
          .put("topic", "error/native")
          .put("level", "error")
          .put("tag", "native")
          .put("data", message)
        val envelope = JSONObject()
          .put("type", "pub")
          .put("event", event)
        Log.e(TAG, "nativeError: $message")
        client.publish(envelope.toString())
        error("native_error_test")
      }
      "isConnected" -> JSONObject().put("result", client.isConnected)
      "setPerformanceOverlayEnabled" -> {
        val params = args.nestedAt(0)
        val enabled = params.getBoolean("enabled", false)
        runtime?.setPerformanceOverlayEnabled(enabled)
        ok()
      }
      "getPerformanceOverlayStats" -> {
        val stats = runtime?.getPerformanceOverlayStats() ?: mapOf(
          "enabled" to false,
          "ramMb" to 0,
          "views" to 0,
          "uiFps" to 0,
          "jsFps" to 0,
        )
        JSONObject().put("result", JSONObject(stats))
      }
      else -> error("unknown_method")
    }
  }

  private fun ok(): JSONObject = JSONObject().put("result", true)

  private fun error(message: String): JSONObject = JSONObject().put("error", message)
}
