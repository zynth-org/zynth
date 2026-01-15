package dev.zynth.haptics

import android.app.Activity
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthHaptics module.
 */
object ZynthHaptics {
    private var moduleInstance: ZynthHapticsModule? = null

    /**
     * Initialize the haptics module with an Activity and ZynthRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("ZynthHaptics", "Module already initialized")
            return
        }

        moduleInstance = ZynthHapticsModule(activity)
        runtime.installModules(listOf(moduleInstance!!))
        android.util.Log.d("ZynthHaptics", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown).
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
