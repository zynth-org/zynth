package dev.zynth.safearea

import android.app.Activity
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthSafeArea module
 */
object ZynthSafeArea {
    private var moduleInstance: ZynthSafeAreaModule? = null
    private var currentActivity: Activity? = null
    private var currentRuntime: ZynthRuntime? = null

    /**
     * Initialize the safe area module with an Activity and ZynthRuntime instance
     * Should be called during app initialization before the JS bundle loads
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null && currentActivity === activity && currentRuntime === runtime) {
            android.util.Log.w("ZynthSafeArea", "Module already initialized for this activity/runtime")
            return
        }

        if (moduleInstance != null) {
            android.util.Log.d("ZynthSafeArea", "Reinitializing module for new activity/runtime")
            cleanup()
        }

        moduleInstance = ZynthSafeAreaModule(activity, runtime)
        runtime.installModules(listOf(moduleInstance!!))
        currentActivity = activity
        currentRuntime = runtime
        android.util.Log.d("ZynthSafeArea", "Module initialized")
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
