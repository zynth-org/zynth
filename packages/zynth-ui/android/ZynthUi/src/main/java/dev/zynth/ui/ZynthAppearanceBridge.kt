package dev.zynth.ui

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

/**
 * Bridge module that exposes appearance state to JavaScript via NativeConstants.
 */
class ZynthAppearanceBridge(
    private val module: ZynthAppearanceModule
) : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthAppearance"

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
