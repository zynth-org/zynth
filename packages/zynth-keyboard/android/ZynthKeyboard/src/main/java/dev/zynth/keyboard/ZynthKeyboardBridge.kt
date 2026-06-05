package dev.zynth.keyboard

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

/**
 * Bridge module that exposes keyboard functionality to JavaScript
 * via the __modules.call() mechanism.
 */
class ZynthKeyboardBridge(
    private val keyboardModule: ZynthKeyboardModule
) : ZynthModule {
    
    override val name: String = "ZynthKeyboard"

    override val exportedMethods: List<String> = listOf("dismiss", "getState", "setHeightSignalId")

    override val constants: Map<String, Any>?
        get() = keyboardModule.getInitialState().toMap()

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "dismiss" -> resultResponse(handleDismiss())
            "getState" -> resultResponse(handleGetState())
            "setHeightSignalId" -> resultResponse(handleSetHeightSignalId(args))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun handleSetHeightSignalId(args: ZynthArgs): JSONObject {
        val id = args.getInt("id") ?: return JSONObject().put("success", false)
        keyboardModule.setHeightSignalId(id)
        return JSONObject().put("success", true)
    }

    private fun handleDismiss(): JSONObject {
        keyboardModule.dismissKeyboard()
        return JSONObject().put("success", true)
    }

    private fun handleGetState(): JSONObject {
        // Could be implemented to return current state if needed
        return JSONObject().put("success", true)
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
