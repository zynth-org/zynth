package com.zynth.kit.runtime.modules

import android.content.Context
import com.zynth.kit.runtime.ZynthModule
import org.json.JSONObject

class DevtoolsModule(private val context: Context) : ZynthModule {
  override val name: String = "Devtools"

  override fun call(method: String, args: Array<Any?>): JSONObject {
    return JSONObject().put("result", false)
  }
}
