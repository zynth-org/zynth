package com.rune.androidrouter

import android.app.Activity
import android.util.Log
import android.view.View
import com.rune.kit.runtime.RuneRuntime

/**
 * Bootstrap class to initialize the RuneAndroidRouter module.
 * This is called from MainActivity to register the router module with the runtime.
 */
object RuneAndroidRouterHost {
    private const val TAG = "RuneAndroidRouterHost"
    
    /**
     * Bootstrap the Android router module with the runtime.
     * This registers the module so it's available to JavaScript.
     * 
     * @param activity The main activity
     * @param runtime The Rune runtime instance
     */
    @JvmStatic
    fun bootstrap(activity: Activity, runtime: RuneRuntime) {
        try {
            Log.i(TAG, "Bootstrapping RuneAndroidRouter module")
            
            // Create and install the router module
            val routerModule = RuneAndroidRouterModule()
            runtime.installModules(listOf(routerModule))
            
            Log.i(TAG, "RuneAndroidRouter module installed successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to bootstrap RuneAndroidRouter", e)
        }
    }
}
