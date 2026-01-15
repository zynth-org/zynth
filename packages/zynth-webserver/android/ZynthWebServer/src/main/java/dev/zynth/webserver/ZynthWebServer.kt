package dev.zynth.webserver

import android.app.Activity
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthWebServer module.
 */
object ZynthWebServer {
    private var moduleInstance: ZynthWebServerModule? = null

    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            Log.w("ZynthWebServer", "Module already initialized")
            return
        }

        moduleInstance = ZynthWebServerModule(activity)
        runtime.installModules(listOf(moduleInstance!!))
        Log.d("ZynthWebServer", "Module initialized")
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance?.shutdown()
        moduleInstance = null
    }
}
