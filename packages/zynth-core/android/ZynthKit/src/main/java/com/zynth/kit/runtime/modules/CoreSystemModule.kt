package com.zynth.kit.runtime.modules

import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import org.json.JSONArray
import org.json.JSONObject

internal class CoreSystemModule(private val runtime: ZynthRuntime) : ZynthModule {
  override val name: String = "CoreSystem"

  override val exportedMethods: List<String> = listOf(
    "enableFeatures",
    "getMetrics",
    "getStartupMetrics",
    "getBudgetMetrics",
  )

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return when (method) {
      "enableFeatures" -> handleEnableFeatures(args)
      "getMetrics" -> JSONObject().put("result", runtime.startupMetrics.makeSnapshot())
      "getStartupMetrics" -> {
        val result = if (runtime.startupMetrics.isStartupTimeEnabled()) {
          runtime.startupMetrics.makeStartupSnapshot()
        } else {
          JSONObject.NULL
        }
        JSONObject().put("result", result)
      }
      "getBudgetMetrics" -> JSONObject().put("result", runtime.getUIManager().budgetMetrics.makeSnapshot())
      else -> JSONObject().put("error", "unknown_method").put("method", method)
    }
  }

  private fun handleEnableFeatures(args: ZynthArgs): JSONObject {
    val features = parseFeatures(args.getAny("features"))
    runtime.startupMetrics.enableFeatures(features)
    if (features.contains("budgetMetrics")) {
      runtime.getUIManager().budgetMetrics.enable(true)
    }
    return JSONObject().put("result", true)
  }

  private fun parseFeatures(raw: Any?): List<String> {
    if (raw == null || raw == JSONObject.NULL) {
      return emptyList()
    }
    if (raw is JSONArray) {
      val list = ArrayList<String>(raw.length())
      for (index in 0 until raw.length()) {
        val value = raw.opt(index)
        if (value is String) {
          list.add(value)
        }
      }
      return list
    }
    if (raw is List<*>) {
      val list = ArrayList<String>(raw.size)
      for (value in raw) {
        if (value is String) {
          list.add(value)
        }
      }
      return list
    }
    return emptyList()
  }
}
