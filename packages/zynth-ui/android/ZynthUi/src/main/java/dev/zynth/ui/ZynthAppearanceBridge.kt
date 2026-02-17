package dev.zynth.ui

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

/**
 * Bridge module that exposes appearance state to JavaScript via NativeConstants.
 */
class ZynthAppearanceBridge(
    private val module: ZynthAppearanceModule
) : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthAppearance"

    override val exportedMethods: List<String> = listOf("getCurrent")

    override val constants: Map<String, Any>?
        get() = module.getInitialState().toMap()

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "getCurrent" -> resultResponse(JSONObject(module.getCurrentState().toMap()))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any {
        return when (method) {
            "getCurrent" -> module.getCurrentState().toMap()
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
