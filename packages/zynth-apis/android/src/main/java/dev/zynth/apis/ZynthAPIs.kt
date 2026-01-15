package dev.zynth.apis

import android.app.Activity
import android.content.Context
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime
import java.util.WeakHashMap

/**
 * Public interface for ZynthAPIs module.
 * Provides Font loading and other core APIs to JavaScript.
 */
object ZynthAPIs {
    private const val TAG = "ZynthAPIs"
    private val initializedRuntimes = WeakHashMap<ZynthRuntime, Boolean>()

    /**
     * Initialize the APIs module with an Activity and ZynthRuntime instance.
     * Called from generated MainActivity during app startup.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        initialize(activity.applicationContext, runtime)
    }

    /**
     * Initialize the APIs module with a Context and ZynthRuntime instance.
     * Use this when an Activity reference is not available (e.g., Views).
     */
    @JvmStatic
    @Synchronized
    fun initialize(context: Context, runtime: ZynthRuntime) {
        Log.d(TAG, "ZynthAPIs.initialize() called")

        if (initializedRuntimes.containsKey(runtime)) {
            Log.w(TAG, "Runtime already initialized - skipping")
            return
        }
        initializedRuntimes[runtime] = true

        Log.d(TAG, "Creating FontModule...")
        val fontModule = FontModule(context.applicationContext)
        Log.d(TAG, "Installing FontModule into runtime...")
        runtime.installModules(listOf(fontModule))

        Log.d(TAG, "ZynthAPIs initialized successfully with FontModule")
    }

    /**
     * Clean up (called during app teardown if needed)
     */
    @JvmStatic
    fun cleanup() {
        initializedRuntimes.clear()
    }
}
