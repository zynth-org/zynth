package dev.rune.keyboard

import android.app.Activity
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneKeyboard module
 */
object RuneKeyboard {
    private var moduleInstance: RuneKeyboardModule? = null

    /**
     * Initialize the keyboard module with an Activity and RuneRuntime instance
     * Should be called during app initialization before the JS bundle loads
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("RuneKeyboard", "Module already initialized")
            return
        }

        moduleInstance = RuneKeyboardModule(activity, runtime)
        android.util.Log.d("RuneKeyboard", "Module initialized")
    }

    /**
     * Clean up the module (called during app teardown)
     */
    @JvmStatic
    fun cleanup() {
        moduleInstance?.onDestroy()
        moduleInstance = null
    }
}
