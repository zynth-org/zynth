package dev.rune.securestore

import android.app.Activity
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneSecureStore module.
 */
object RuneSecureStore {
    private var moduleInstance: RuneSecureStoreModule? = null

    /**
     * Initialize the SecureStore module with an Activity and RuneRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("RuneSecureStore", "Module already initialized")
            return
        }

        moduleInstance = RuneSecureStoreModule(activity)
        runtime.installModules(listOf(moduleInstance!!))
        android.util.Log.d("RuneSecureStore", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown).
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
