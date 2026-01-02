package dev.rune.asyncstorage

import android.app.Activity
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneAsyncStorage module.
 */
object RuneAsyncStorage {
    private var moduleInstance: RuneAsyncStorageModule? = null

    /**
     * Initialize the AsyncStorage module with an Activity and RuneRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("RuneAsyncStorage", "Module already initialized")
            return
        }

        moduleInstance = RuneAsyncStorageModule(activity.applicationContext)
        runtime.installModules(listOf(moduleInstance!!))
        android.util.Log.d("RuneAsyncStorage", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown).
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
