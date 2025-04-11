package dev.rune.safearea

import android.app.Activity
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneSafeArea module
 */
object RuneSafeArea {
    private var moduleInstance: RuneSafeAreaModule? = null

    /**
     * Initialize the safe area module with an Activity and RuneRuntime instance
     * Should be called during app initialization before the JS bundle loads
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("RuneSafeArea", "Module already initialized")
            return
        }

        moduleInstance = RuneSafeAreaModule(activity, runtime)
        android.util.Log.d("RuneSafeArea", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown)
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance?.onDestroy()
        moduleInstance = null
    }
}
