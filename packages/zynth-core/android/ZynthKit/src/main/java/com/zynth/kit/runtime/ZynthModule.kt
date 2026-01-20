package com.zynth.kit.runtime

import org.json.JSONObject

interface ZynthModule {
  val name: String
  fun call(method: String, args: Array<Any?>): JSONObject
}
