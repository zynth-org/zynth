package dev.rune.apis

import android.app.Activity
import android.util.Log
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneAPIs module.
 * Provides Font loading and other core APIs to JavaScript.
 */
object RuneAPIs {
    private const val TAG = "RuneAPIs"
    private var initialized = false

    /**
     * Initialize the APIs module with an Activity and RuneRuntime instance.
     * Called from generated MainActivity during app startup.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        Log.d(TAG, "RuneAPIs.initialize() called")
        
        if (initialized) {
            Log.w(TAG, "Module already initialized - skipping")
            return
        }

        // Install FontModule
        Log.d(TAG, "Creating FontModule...")
        val fontModule = FontModule(activity.applicationContext)
        Log.d(TAG, "Installing FontModule into runtime...")
        runtime.installModules(listOf(fontModule))
        
        initialized = true
        Log.d(TAG, "RuneAPIs initialized successfully with FontModule")
    }

    /**
     * Clean up (called during app teardown if needed)
     */
    @JvmStatic
    fun cleanup() {
        initialized = false
    }
}
