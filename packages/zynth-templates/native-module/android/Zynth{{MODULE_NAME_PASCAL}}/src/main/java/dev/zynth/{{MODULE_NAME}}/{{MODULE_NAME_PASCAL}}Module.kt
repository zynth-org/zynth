package dev.zynth.{{MODULE_NAME}}

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

class {{MODULE_NAME_PASCAL}}Module : ZynthModule, ZynthSyncModule {
    override val name = "{{MODULE_NAME_PASCAL}}"

    override val constants: Map<String, Any>?
        get() = mapOf("exampleConstant" to "Hello from Android")

    override fun initialize() {
        // Module setup
    }

    override fun invalidate() {
        // Cleanup
    }

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "exampleMethod" -> JSONObject().put("result", "Async result")
            else -> JSONObject().put("error", "unknown_method")
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "exampleSyncMethod" -> "Sync result"
            else -> null
        }
    }
}