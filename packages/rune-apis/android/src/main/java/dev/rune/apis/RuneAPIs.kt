package dev.rune.apis

import android.app.Activity
import android.content.Context
import android.util.Log
import com.rune.kit.runtime.RuneRuntime
import java.util.WeakHashMap

/**
 * Public interface for RuneAPIs module.
 * Provides Font loading and other core APIs to JavaScript.
 */
object RuneAPIs {
    private const val TAG = "RuneAPIs"
    private val initializedRuntimes = WeakHashMap<RuneRuntime, Boolean>()

    /**
     * Initialize the APIs module with an Activity and RuneRuntime instance.
     * Called from generated MainActivity during app startup.
     */
    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        initialize(activity.applicationContext, runtime)
    }

    /**
     * Initialize the APIs module with a Context and RuneRuntime instance.
     * Use this when an Activity reference is not available (e.g., Views).
     */
    @JvmStatic
    @Synchronized
    fun initialize(context: Context, runtime: RuneRuntime) {
        Log.d(TAG, "RuneAPIs.initialize() called")

        if (initializedRuntimes.containsKey(runtime)) {
            Log.w(TAG, "Runtime already initialized - skipping")
            return
        }
        initializedRuntimes[runtime] = true

        Log.d(TAG, "Creating FontModule...")
        val fontModule = FontModule(context.applicationContext)
        Log.d(TAG, "Installing FontModule into runtime...")
        runtime.installModules(listOf(fontModule))

        Log.d(TAG, "RuneAPIs initialized successfully with FontModule")
    }

    /**
     * Clean up (called during app teardown if needed)
     */
    @JvmStatic
    fun cleanup() {
        initializedRuntimes.clear()
    }
}
