package com.zynth.kit.runtime.modules

import android.content.Context
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthNativeErrorOverlay
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
    @JvmStatic
    fun start(context: Context) {
      context.hashCode()
    }

    @JvmStatic
    fun emitNativeEvent(eventJson: String?) {
      ZynthNativeErrorOverlay.handleRawEvent(eventJson)
    }

    @JvmStatic
    fun isConnected(): Boolean {
      return false
    }

    @JvmStatic
    fun setInboundSink(@Suppress("UNUSED_PARAMETER") sink: ((String) -> Unit)?) {}
  }

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return when (method) {
      "emit" -> {
        runCatching {
          val eventMap = args.getMapAt(0)
          val event = JSONObject(eventMap)
          if (event.has("topic")) {
            val envelope = JSONObject()
              .put("type", "pub")
              .put("event", event)
            ZynthNativeErrorOverlay.handleRawEvent(envelope.toString())
          }
        }
        JSONObject().put("result", true)
      }
      "setPerformanceOverlayEnabled" -> {
        val params = args.nestedAt(0)
        val enabled = params.getBoolean("enabled", false)
        runtime?.setPerformanceOverlayEnabled(enabled)
        JSONObject().put("result", true)
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
      else -> JSONObject().put("result", false)
    }
  }
}
