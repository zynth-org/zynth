package dev.zynth.splashscreen

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

/**
 * Bridge module that exposes splash screen controls to JavaScript
 * via the __modules.call() mechanism.
 */
class ZynthSplashScreenModule : ZynthModule {
    override val name: String = "ZynthSplashScreen"

    override val exportedMethods: List<String> = listOf("preventAutoHide", "hide")

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "preventAutoHide" -> resultResponse(handlePreventAutoHide())
            "hide" -> resultResponse(handleHide())
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun handlePreventAutoHide(): JSONObject {
        ZynthSplashScreen.preventAutoHide()
        return JSONObject().put("success", true)
    }

    private fun handleHide(): JSONObject {
        ZynthSplashScreen.hide()
        return JSONObject().put("success", true)
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
