package dev.zynth.{{MODULE_NAME}}

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

/**
 * Bridge module that exposes state to JavaScript via NativeConstants and __modules.
 */
class {{MODULE_NAME_PASCAL}}Bridge(
    private val module: {{MODULE_NAME_PASCAL}}Module
) : ZynthModule, ZynthSyncModule {
    override val name: String = "{{MODULE_NAME_PASCAL}}"

    override val exportedMethods: List<String> = listOf("getCurrentState")
    override val protectedMethods: List<String> = emptyList()

    override val constants: Map<String, Any>?
        get() = module.getInitialState().toMap()

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "getCurrentState" -> resultResponse(JSONObject(module.getInitialState().toMap()))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "getCurrentState" -> module.getInitialState().toMap()
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
