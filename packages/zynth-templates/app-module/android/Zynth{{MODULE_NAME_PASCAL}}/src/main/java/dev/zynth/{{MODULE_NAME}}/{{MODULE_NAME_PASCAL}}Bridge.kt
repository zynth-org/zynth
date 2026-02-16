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

    override val constants: Map<String, Any>?
        get() = module.getInitialState().toMap()

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            else -> JSONObject()
                .put("error", "unsupported_method")
                .put("message", method)
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "getCurrentState" -> module.getInitialState().toMap()
            else -> null
        }
    }
}
