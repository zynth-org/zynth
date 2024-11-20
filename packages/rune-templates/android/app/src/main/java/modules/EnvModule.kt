package {{BUNDLE_ID}}.modules

import android.os.Build
import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneSyncModule
import org.json.JSONObject

class EnvModule : RuneModule, RuneSyncModule {
  override val name: String = "Env"

  override fun call(method: String, argsJson: String): String {
    return when (method) {
      "constants" -> jsonResponse(constantsPayload())
      else -> errorResponse(method)
    }
  }

  override fun callSync(method: String, argsJson: String): String? {
    return when (method) {
      "constants" -> jsonResponse(constantsPayload())
      else -> throw IllegalStateException("Env module does not implement $method")
    }
  }

  private fun constantsPayload(): JSONObject {
    return JSONObject()
      .put("platform", "android")
      .put("manufacturer", Build.MANUFACTURER ?: "unknown")
      .put("model", Build.MODEL ?: "unknown")
      .put("version", Build.VERSION.RELEASE ?: "unknown")
      .put("sdk", Build.VERSION.SDK_INT)
      .put("timestamp", System.currentTimeMillis())
  }

  private fun jsonResponse(result: JSONObject): String {
    return JSONObject()
      .put("ok", true)
      .put("result", result)
      .toString()
  }

  private fun errorResponse(method: String): String {
    return JSONObject()
      .put("ok", false)
      .put("error", "unknown_method")
      .put("method", method)
      .toString()
  }
}
