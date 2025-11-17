package dev.rune.haptics

import android.app.Activity
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneHaptics module.
 */
object RuneHaptics {
    private var moduleInstance: RuneHapticsModule? = null

    /**
     * Initialize the haptics module with an Activity and RuneRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("RuneHaptics", "Module already initialized")
            return
        }

        moduleInstance = RuneHapticsModule(activity)
        runtime.installModules(listOf(moduleInstance!!))
        android.util.Log.d("RuneHaptics", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown).
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
