package {{BUNDLE_ID}}.modules

import android.os.Build
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

class DeviceModule : ZynthModule, ZynthSyncModule {
    override val name: String = "Device"

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "info" -> deviceInfo()
            "constants" -> jsonResponse(constantsPayload())
            else -> errorResponse(method)
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "constants" -> constantsPayload()
            else -> throw IllegalStateException("Device module does not implement $method")
        }
    }

    private fun deviceInfo(): JSONObject {
        return jsonResponse(
            JSONObject()
                .put("platform", "android")
                .put("manufacturer", Build.MANUFACTURER ?: "unknown")
                .put("model", Build.MODEL ?: "unknown")
                .put("version", Build.VERSION.RELEASE ?: "unknown")
        )
    }

    private fun constantsPayload(): JSONObject {
        return JSONObject()
            .put("platform", "android")
            .put("runtime", "hermes")
            .put("manufacturer", Build.MANUFACTURER ?: "unknown")
            .put("model", Build.MODEL ?: "unknown")
            .put("version", Build.VERSION.RELEASE ?: "unknown")
            .put("sdk", Build.VERSION.SDK_INT)
            .put("timestamp", System.currentTimeMillis())
    }

    private fun errorResponse(method: String): JSONObject {
        return JSONObject()
            .put("ok", false)
            .put("error", "unknown_method")
            .put("method", method)
    }

    private fun jsonResponse(result: JSONObject): JSONObject {
        return JSONObject()
            .put("ok", true)
            .put("result", result)
    }
}
