package com.rune.kit.runtime.modules

import android.content.Context
import com.rune.kit.runtime.RuneModule
import org.json.JSONObject

class DevtoolsModule(private val context: Context) : RuneModule {
  override val name: String = "Devtools"

  override fun call(method: String, args: Array<Any?>): JSONObject {
    return JSONObject().put("result", false)
  }
}
