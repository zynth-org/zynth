package dev.zynth.keyboard

import android.app.Activity
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthKeyboard module
 */
object ZynthKeyboard {
    private var moduleInstance: ZynthKeyboardModule? = null

    /**
     * Initialize the keyboard module with an Activity and ZynthRuntime instance
     * Should be called during app initialization before the JS bundle loads
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("ZynthKeyboard", "Module already initialized")
            return
        }

        moduleInstance = ZynthKeyboardModule(activity, runtime)
        android.util.Log.d("ZynthKeyboard", "Module initialized")
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
