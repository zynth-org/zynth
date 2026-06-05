package dev.zynth.ui

import android.app.Activity
import android.content.res.Configuration
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Canonical package bootstrap entrypoint for @zynthjs/ui native modules.
 */
object ZynthUIBootstrap {
    private var moduleInstance: ZynthAppearanceModule? = null

    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            Log.d("ZynthUIBootstrap", "Re-initializing module")
            moduleInstance?.onDestroy()
        }

        moduleInstance = ZynthAppearanceModule(activity, runtime)
        Log.d("ZynthUIBootstrap", "Module initialized")
    }

    @JvmStatic
    fun onConfigurationChanged(newConfig: Configuration) {
        moduleInstance?.onConfigurationChanged(newConfig)
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance?.onDestroy()
        moduleInstance = null
    }
}
