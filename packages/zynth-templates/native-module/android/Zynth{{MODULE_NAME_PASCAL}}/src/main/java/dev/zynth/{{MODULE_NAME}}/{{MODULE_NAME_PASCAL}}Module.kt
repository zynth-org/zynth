package dev.zynth.{{MODULE_NAME}}

import com.zynth.kit.runtime.ZynthModule

import com.zynth.kit.runtime.ZynthSyncModule

import com.zynth.kit.runtime.ZynthArgs

import org.json.JSONObject



class {{MODULE_NAME_PASCAL}}Module : ZynthModule, ZynthSyncModule {
    override val name = "{{MODULE_NAME_PASCAL}}"

    override val exportedMethods: List<String> = listOf("exampleMethod", "exampleSyncMethod")
    override val protectedMethods: List<String> = emptyList()

    override val constants: Map<String, Any>?
        get() = mapOf("exampleConstant" to "Hello from Android")

    override fun initialize() {
        // Module setup
    }

    override fun invalidate() {
        // Cleanup
    }

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "exampleMethod" -> resultResponse("Async result")
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "exampleSyncMethod" -> "Sync result"
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
