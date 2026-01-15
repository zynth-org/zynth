package dev.rune.filesystem

import android.app.Activity
import android.util.Log
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneFileSystem module.
 */
object RuneFileSystem {
    private var moduleInstance: RuneFileSystemModule? = null

    /**
     * Initialize the FileSystem module with an Activity and RuneRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            Log.w("RuneFileSystem", "Module already initialized")
            return
        }

        moduleInstance = RuneFileSystemModule(activity.applicationContext)
        runtime.installModules(listOf(moduleInstance!!))
        Log.d("RuneFileSystem", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown).
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
