package dev.zynth.filesystem

import android.app.Activity
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthFileSystem module.
 */
object ZynthFileSystem {
    private var moduleInstance: ZynthFileSystemModule? = null

    /**
     * Initialize the FileSystem module with an Activity and ZynthRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            Log.w("ZynthFileSystem", "Module already initialized")
            return
        }

        moduleInstance = ZynthFileSystemModule(activity.applicationContext)
        runtime.installModules(listOf(moduleInstance!!))
        Log.d("ZynthFileSystem", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown).
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
