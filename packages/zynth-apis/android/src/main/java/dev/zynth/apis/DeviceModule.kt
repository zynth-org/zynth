package dev.zynth.apis

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

class DeviceModule(
    context: Context,
) : ZynthModule, ZynthSyncModule {

    override val name: String = "Device"

    override val exportedMethods: List<String> = listOf("getInfo", "current")

    private val appContext = context.applicationContext

    override val constants: Map<String, Any>?
        get() = deviceInfo()

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "getInfo", "current" -> resultResponse(JSONObject(deviceInfo()))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "getInfo", "current" -> deviceInfo()
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }

    private fun deviceInfo(): Map<String, Any> {
        val androidId = Settings.Secure.getString(
            appContext.contentResolver,
            Settings.Secure.ANDROID_ID,
        )

        return mapOf(
            "platform" to "android",
            "model" to Build.MODEL,
            "modelId" to Build.DEVICE,
            "brand" to Build.BRAND,
            "manufacturer" to Build.MANUFACTURER,
            "deviceName" to Build.PRODUCT,
            "osName" to "Android",
            "osVersion" to Build.VERSION.RELEASE,
            "osBuildId" to Build.DISPLAY,
            "serialNumber" to (readSerialNumber() ?: ""),
            "uniqueId" to (androidId ?: ""),
            "sdkInt" to Build.VERSION.SDK_INT,
            "isEmulator" to isProbablyEmulator(),
        )
    }

    private fun readSerialNumber(): String? {
        return runCatching {
            val raw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Build.getSerial()
            } else {
                @Suppress("DEPRECATION")
                Build.SERIAL
            }
            raw.takeIf { !it.isNullOrBlank() && !it.equals("unknown", ignoreCase = true) }
        }.getOrNull()
    }

    private fun isProbablyEmulator(): Boolean {
        val fingerprint = Build.FINGERPRINT.lowercase()
        val model = Build.MODEL.lowercase()
        val product = Build.PRODUCT.lowercase()
        val hardware = Build.HARDWARE.lowercase()
        return fingerprint.contains("generic") ||
            fingerprint.contains("emulator") ||
            model.contains("emulator") ||
            model.contains("android sdk built for") ||
            product.contains("sdk") ||
            hardware.contains("goldfish") ||
            hardware.contains("ranchu")
    }
}
