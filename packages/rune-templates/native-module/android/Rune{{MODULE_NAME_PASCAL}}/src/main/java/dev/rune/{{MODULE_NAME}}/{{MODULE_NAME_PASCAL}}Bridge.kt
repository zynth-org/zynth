package dev.rune.{{MODULE_NAME}}

import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneSyncModule
import org.json.JSONObject

/**
 * Bridge module that exposes state to JavaScript via NativeConstants and __modules.
 */
class {{MODULE_NAME_PASCAL}}Bridge(
    private val module: {{MODULE_NAME_PASCAL}}Module
) : RuneModule, RuneSyncModule {
    override val name: String = "{{MODULE_NAME_PASCAL}}"

    override val constants: Map<String, Any>?
        get() = module.getInitialState().toMap()

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            else -> JSONObject()
                .put("error", "unsupported_method")
                .put("message", method)
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "getCurrentState" -> module.getInitialState().toMap()
            else -> null
        }
    }
}
