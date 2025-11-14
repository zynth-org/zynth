package dev.rune.splashscreen

import com.rune.kit.runtime.RuneModule
import org.json.JSONObject

/**
 * Bridge module that exposes splash screen controls to JavaScript
 * via the __modules.call() mechanism.
 */
class RuneSplashScreenModule : RuneModule {
    override val name: String = "RuneSplashScreen"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "preventAutoHide" -> handlePreventAutoHide()
            "hide" -> handleHide()
            else -> errorResponse("unsupported_method", method)
        }
    }

    private fun handlePreventAutoHide(): JSONObject {
        RuneSplashScreen.preventAutoHide()
        return successResponse()
    }

    private fun handleHide(): JSONObject {
        RuneSplashScreen.hide()
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
