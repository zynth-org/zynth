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
            
            // Store the main runtime so Fragments can use it
            RuneNavigationContainer.setMainRuntime(runtime)
            
            // Create navigation container with access to FragmentManager
            val navigationContainer = RuneNavigationContainer()
            if (activity is androidx.fragment.app.FragmentActivity) {
                navigationContainer.initialize(
                    android.R.id.content,
                    activity.supportFragmentManager
                )
                Log.i(TAG, "Navigation container initialized with FragmentManager")
            } else {
                Log.w(TAG, "Activity is not a FragmentActivity, native navigation unavailable")
            }
            
            // Create and install the router module
            val routerModule = RuneAndroidRouterModule(navigationContainer)
            Log.e(TAG, "🔥 About to install module with name: ${routerModule.name}")
            runtime.installModules(listOf(routerModule))
            
            Log.e(TAG, "🔥 RuneAndroidRouter module installed - verifying via reflection...")
            
            // Verify module is registered by checking registry
            try {
                val registryField = runtime.javaClass.getDeclaredField("registry")
                registryField.isAccessible = true
                val registry = registryField.get(runtime)
                val modulesField = registry.javaClass.getDeclaredField("modules")
                modulesField.isAccessible = true
                val modules = modulesField.get(registry) as? Map<*, *>
                Log.e(TAG, "🔥 Registry modules: ${modules?.keys}")
                Log.e(TAG, "🔥 Contains RuneAndroidRouter? ${modules?.containsKey("RuneAndroidRouter")}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to verify registry", e)
            }
            
            Log.i(TAG, "RuneAndroidRouter module installed successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to bootstrap RuneAndroidRouter", e)
        }
    }
}
