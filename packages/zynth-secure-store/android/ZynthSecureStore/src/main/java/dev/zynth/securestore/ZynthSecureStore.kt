package dev.zynth.securestore

import android.app.Activity
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthSecureStore module.
 */
object ZynthSecureStore {
    private var moduleInstance: ZynthSecureStoreModule? = null

    /**
     * Initialize the SecureStore module with an Activity and ZynthRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("ZynthSecureStore", "Module already initialized")
            return
        }

        moduleInstance = ZynthSecureStoreModule(activity)
        runtime.installModules(listOf(moduleInstance!!))
        android.util.Log.d("ZynthSecureStore", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown).
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
