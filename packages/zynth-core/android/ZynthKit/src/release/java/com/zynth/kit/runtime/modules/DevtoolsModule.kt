package com.zynth.kit.runtime.modules

import android.content.Context
import com.zynth.kit.runtime.ZynthModule
import org.json.JSONObject

class DevtoolsModule(private val context: Context) : ZynthModule {
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
  }

  override fun call(method: String, args: Array<Any?>): JSONObject {
    return JSONObject().put("result", false)
  }
}
