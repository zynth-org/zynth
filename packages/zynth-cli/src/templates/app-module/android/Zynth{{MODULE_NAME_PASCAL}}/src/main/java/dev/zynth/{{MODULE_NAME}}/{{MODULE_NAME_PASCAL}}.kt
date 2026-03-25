package dev.zynth.{{MODULE_NAME}}

import android.app.Activity
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for Zynth{{MODULE_NAME_PASCAL}} module.
 */
object {{MODULE_NAME_PASCAL}} {
    private var moduleInstance: {{MODULE_NAME_PASCAL}}Module? = null

    /**
     * Initialize the module with an Activity and ZynthRuntime instance.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            Log.w("{{MODULE_NAME_PASCAL}}", "Module already initialized")
            return
        }

        moduleInstance = {{MODULE_NAME_PASCAL}}Module(activity, runtime)
        Log.d("{{MODULE_NAME_PASCAL}}", "Module initialized")
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
