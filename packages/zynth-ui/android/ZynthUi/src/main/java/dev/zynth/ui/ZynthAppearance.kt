package dev.zynth.ui

import android.app.Activity
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthAppearance module.
 */
object ZynthAppearance {
    private var moduleInstance: ZynthAppearanceModule? = null

    /**
     * Initialize the module with an Activity and ZynthRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            Log.d("ZynthAppearance", "Re-initializing module")
            moduleInstance?.onDestroy()
        }

        moduleInstance = ZynthAppearanceModule(activity, runtime)
        Log.d("ZynthAppearance", "Module initialized")
    }

    /**
     * Clean up the module.
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance?.onDestroy()
        moduleInstance = null
    }
}
