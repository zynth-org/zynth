package dev.rune.keyboard

import android.util.Log
import com.rune.kit.runtime.RuneModule
import org.json.JSONObject

/**
 * Bridge module that exposes keyboard functionality to JavaScript
 * via the __modules.call() mechanism.
 */
class RuneKeyboardBridge(
    private val keyboardModule: RuneKeyboardModule
) : RuneModule {
    
    override val name: String = "RuneKeyboard"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        Log.d("RuneKeyboardBridge", "call($method)")
        return when (method) {
            "dismiss" -> handleDismiss()
            "getState" -> handleGetState()
            else -> errorResponse("unsupported_method", method)
        }
    }

    private fun handleDismiss(): JSONObject {
        Log.d("RuneKeyboardBridge", "handleDismiss() invoked from JS")
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
