package dev.rune.safearea

import android.app.Activity
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneSafeArea module
 */
object RuneSafeArea {
    private var moduleInstance: RuneSafeAreaModule? = null
    private var currentActivity: Activity? = null
    private var currentRuntime: RuneRuntime? = null

    /**
     * Initialize the safe area module with an Activity and RuneRuntime instance
     * Should be called during app initialization before the JS bundle loads
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null && currentActivity === activity && currentRuntime === runtime) {
            android.util.Log.w("RuneSafeArea", "Module already initialized for this activity/runtime")
            return
        }

        if (moduleInstance != null) {
            android.util.Log.d("RuneSafeArea", "Reinitializing module for new activity/runtime")
            cleanup()
        }

        moduleInstance = RuneSafeAreaModule(activity, runtime)
        runtime.installModules(listOf(moduleInstance!!))
        currentActivity = activity
        currentRuntime = runtime
        android.util.Log.d("RuneSafeArea", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown)
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance?.onDestroy()
        moduleInstance = null
        currentActivity = null
        currentRuntime = null
    }
}
