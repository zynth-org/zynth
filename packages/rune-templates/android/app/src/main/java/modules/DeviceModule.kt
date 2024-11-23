package {{BUNDLE_ID}}.modules

import android.os.Build
import com.rune.kit.runtime.RuneModule
import org.json.JSONObject

class DeviceModule : RuneModule {
    override val name: String = "Device"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "info" -> deviceInfo()
            else -> errorResponse(method)
        }
    }

    private fun deviceInfo(): JSONObject {
        val payload = JSONObject()
            .put("platform", "android")
            .put("manufacturer", Build.MANUFACTURER ?: "unknown")
            .put("model", Build.MODEL ?: "unknown")
            .put("version", Build.VERSION.RELEASE ?: "unknown")

        return JSONObject()
            .put("ok", true)
            .put("result", payload)
    }

    private fun errorResponse(method: String): JSONObject {
        return JSONObject()
            .put("ok", false)
            .put("error", "unknown_method")
            .put("method", method)
    }
}