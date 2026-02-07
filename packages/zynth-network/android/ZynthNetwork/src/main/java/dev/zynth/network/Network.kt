package dev.zynth.network

import android.app.Activity
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime

object Network {
    private var moduleInstance: NetworkModule? = null

    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            Log.w("Network", "Module already initialized")
            return
        }

        moduleInstance = NetworkModule(activity.applicationContext)
        runtime.installModules(listOf(moduleInstance!!))
        Log.d("Network", "Module initialized")
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance?.shutdown()
        moduleInstance = null
    }
}
