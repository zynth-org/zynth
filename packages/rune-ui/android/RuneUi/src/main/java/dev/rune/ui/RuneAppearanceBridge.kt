package dev.rune.ui

import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneSyncModule
import org.json.JSONObject

/**
 * Bridge module that exposes appearance state to JavaScript via NativeConstants.
 */
class RuneAppearanceBridge(
    private val module: RuneAppearanceModule
) : RuneModule, RuneSyncModule {
    override val name: String = "RuneAppearance"

    override val constants: Map<String, Any>?
        get() = module.getInitialState().toMap()

    @Suppress("UNUSED_PARAMETER")
    override fun call(method: String, args: Array<Any?>): JSONObject {
        return JSONObject()
            .put("error", "unsupported_method")
            .put("message", method)
    }

    @Suppress("UNUSED_PARAMETER")
    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "getCurrent" -> JSONObject(module.getCurrentState().toMap())
            else -> null
        }
    }
}
