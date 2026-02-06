package com.zynth.kit.runtime.modules

import android.content.Context
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import org.json.JSONObject

class DevtoolsModule(
  private val context: Context,
  private val runtime: ZynthRuntime? = null
) : ZynthModule {
  override val name: String = "Devtools"

  companion object {
    @JvmStatic
    fun start(context: Context) {
      context.hashCode()
    }

    @JvmStatic
    fun emitNativeEvent(eventJson: String?) {
      eventJson?.length
    }

    @JvmStatic
    fun isConnected(): Boolean {
      return false
    }

    @JvmStatic
    fun setInboundSink(@Suppress("UNUSED_PARAMETER") sink: ((String) -> Unit)?) {}
  }

  override fun call(method: String, args: Array<Any?>): JSONObject {
    return JSONObject().put("result", false)
  }
}
