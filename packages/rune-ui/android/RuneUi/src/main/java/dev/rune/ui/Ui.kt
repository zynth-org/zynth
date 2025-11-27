package dev.rune.ui

import android.app.Activity
import android.util.Log
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneUi module.
 */
object Ui {
    private var moduleInstance: UiModule? = null

    /**
     * Initialize the module with an Activity and RuneRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            Log.w("Ui", "Module already initialized")
            return
        }

        moduleInstance = UiModule(activity, runtime)
        Log.d("Ui", "Module initialized")
    }

    /**
     * Clean up the module.
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance?.onDestroy()
        moduleInstance = null
    }
}
