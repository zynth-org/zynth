package dev.rune.ui

import android.app.Activity
import android.util.Log
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneAppearance module.
 */
object RuneAppearance {
    private var moduleInstance: RuneAppearanceModule? = null

    /**
     * Initialize the module with an Activity and RuneRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            Log.d("RuneAppearance", "Re-initializing module")
            moduleInstance?.onDestroy()
        }

        moduleInstance = RuneAppearanceModule(activity, runtime)
        Log.d("RuneAppearance", "Module initialized")
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
