package dev.zynth.asyncstorage

import android.app.Activity
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthAsyncStorage module.
 */
object ZynthAsyncStorage {
    private var moduleInstance: ZynthAsyncStorageModule? = null

    /**
     * Initialize the AsyncStorage module with an Activity and ZynthRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("ZynthAsyncStorage", "Module already initialized")
            return
        }

        moduleInstance = ZynthAsyncStorageModule(activity.applicationContext)
        runtime.installModules(listOf(moduleInstance!!))
        android.util.Log.d("ZynthAsyncStorage", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown).
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
