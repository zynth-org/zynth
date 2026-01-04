package com.rune.kit.runtime.modules

import android.content.Context
import com.rune.kit.dev.RuneDevtoolsClient
import com.rune.kit.runtime.RuneModule
import java.io.File
import java.nio.charset.Charset
import org.json.JSONObject

class DevtoolsModule(private val context: Context) : RuneModule {
  override val name: String = "Devtools"

  private val client = RuneDevtoolsClient()

  override fun initialize() {
    val envUrl = readSystemValue("RUNE_DEVTOOLS_URL")
    val envToken = readSystemValue("RUNE_DEVTOOLS_TOKEN")
    if (envUrl != null) {
      client.connect(envUrl, envToken)
      return
    }

    loadPersistedDevtoolsConfig()?.let { (url, token) ->
      client.connect(url, token)
    }
  }

  override fun invalidate() {
    client.disconnect()
  }

  override fun call(method: String, args: Array<Any?>): JSONObject {
    return when (method) {
      "connect" -> {
        val payload = args.firstOrNull() as? Map<*, *> ?: return error("invalid_arguments")
        val url = payload["url"] as? String ?: return error("invalid_url")
        val token = payload["token"] as? String
        client.connect(url, token)
        ok()
      }
      "emit" -> {
        val payload = args.firstOrNull()
        val event = when (payload) {
          is Map<*, *> -> JSONObject(payload)
          is JSONObject -> payload
          else -> return error("invalid_arguments")
        }
        if (!event.has("ts")) {
          event.put("ts", System.currentTimeMillis())
        }
        if (!event.has("topic")) {
          return error("missing_topic")
        }
        val envelope = JSONObject()
          .put("type", "pub")
          .put("event", event)
        client.publish(envelope.toString())
        ok()
      }
      "isConnected" -> JSONObject().put("result", client.isConnected)
      else -> error("unknown_method")
    }
  }

  private fun ok(): JSONObject = JSONObject().put("result", true)

  private fun error(message: String): JSONObject = JSONObject().put("error", message)

  private fun readSystemValue(key: String): String? {
    val prop = System.getProperty(key)
    if (!prop.isNullOrBlank()) return prop
    val env = System.getenv(key)
    return env?.takeIf { it.isNotBlank() }
  }

  private fun loadPersistedDevtoolsConfig(): Pair<String, String?>? {
    return readConfigFile(File(context.filesDir, ".rune/dev-server.json"))
      ?: readAssetConfig("rune-dev-config.json")
  }

  private fun readConfigFile(file: File): Pair<String, String?>? {
    if (!file.exists()) return null
    val raw = runCatching { file.readText(Charset.forName("UTF-8")) }.getOrNull()
      ?: return null
    return parseConfig(raw)
  }

  private fun readAssetConfig(name: String): Pair<String, String?>? {
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
