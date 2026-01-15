package dev.zynth.splashscreen

import com.zynth.kit.runtime.ZynthModule
import org.json.JSONObject

/**
 * Bridge module that exposes splash screen controls to JavaScript
 * via the __modules.call() mechanism.
 */
class ZynthSplashScreenModule : ZynthModule {
    override val name: String = "ZynthSplashScreen"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "preventAutoHide" -> handlePreventAutoHide()
            "hide" -> handleHide()
            else -> errorResponse("unsupported_method", method)
        }
    }

    private fun handlePreventAutoHide(): JSONObject {
        ZynthSplashScreen.preventAutoHide()
        return successResponse()
    }

    private fun handleHide(): JSONObject {
        ZynthSplashScreen.hide()
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
