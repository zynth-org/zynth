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

    override val constants: Map<String, Any>?
        get() = keyboardModule.getInitialState().toMap()

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "dismiss" -> handleDismiss()
            "getState" -> handleGetState()
            else -> errorResponse("unsupported_method", method)
        }
    }

    private fun handleDismiss(): JSONObject {
        keyboardModule.dismissKeyboard()
        return successResponse()
    }

    private fun handleGetState(): JSONObject {
        // Could be implemented to return current state if needed
        return successResponse()
    }

    private fun successResponse(): JSONObject {
        return JSONObject().apply {
            put("success", true)
        }
    }

    private fun errorResponse(error: String, message: String): JSONObject {
        return JSONObject().apply {
            put("error", error)
            put("message", message)
        }
    }
}
