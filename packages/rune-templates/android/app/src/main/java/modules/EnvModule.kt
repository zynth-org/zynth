package {{BUNDLE_ID}}.modules

import android.os.Build
import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneSyncModule
import org.json.JSONObject
import java.nio.ByteBuffer

class EnvModule : RuneModule, RuneSyncModule {
    override val name: String = "Env"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "constants" -> jsonResponse(constantsPayload())
            "echoData" -> handleEchoData(args)
            else -> errorResponse(method)
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "constants" -> constantsPayload()
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

    private fun handleEchoData(args: Array<Any?>): JSONObject {
        val payload = args.firstOrNull() as? Map<*, *> ?: return errorResponse("echoData", "invalid_payload")
        val buffer = payload["payload"] as? ByteBuffer ?: return errorResponse("echoData", "missing_buffer")

        val checksum = fnv1a32Hex(buffer)
        buffer.rewind()

        return jsonResponse(
            JSONObject()
                .put("byteLength", buffer.remaining())
                .put("checksum", checksum)
                .put("echo", buffer)
        )
    }

    private fun fnv1a32Hex(data: ByteBuffer): String {
        var hash = 0x811C9DC5.toInt()
        while (data.hasRemaining()) {
            hash = hash xor (data.get().toInt() and 0xFF)
            hash *= 16777619
        }
        return String.format("%08x", hash)
    }

    private fun jsonResponse(result: JSONObject): JSONObject {
        return JSONObject()
            .put("ok", true)
            .put("result", result)
    }

    private fun errorResponse(method: String, message: String = "unknown_method"): JSONObject {
        return JSONObject()
            .put("ok", false)
            .put("error", message)
            .put("method", method)
    }
}
