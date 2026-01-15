package dev.rune.webserver

import android.app.Activity
import android.util.Log
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneWebServer module.
 */
object RuneWebServer {
    private var moduleInstance: RuneWebServerModule? = null

    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            Log.w("RuneWebServer", "Module already initialized")
            return
        }

        moduleInstance = RuneWebServerModule(activity)
        runtime.installModules(listOf(moduleInstance!!))
        Log.d("RuneWebServer", "Module initialized")
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance?.shutdown()
        moduleInstance = null
    }
}
