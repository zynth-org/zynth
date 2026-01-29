package dev.zynth.apis

import android.app.Activity
import android.content.Context
import android.util.Log
import com.zynth.kit.runtime.FontRegistry
import com.zynth.kit.runtime.ZynthRuntime
import dev.zynth.apis.safearea.ZynthSafeAreaModule
import java.util.WeakHashMap

/**
 * Public interface for ZynthAPIs module.
 * Provides Font, Dimensions, Fetch, and BackHandler APIs to JavaScript.
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
        // Log.d(TAG, "ZynthAPIs.initialize() called")

        if (initializedRuntimes.containsKey(runtime)) {
            Log.w(TAG, "Runtime already initialized - skipping")
            return
        }
        initializedRuntimes[runtime] = true

        // Log.d(TAG, "Creating modules...")
        val fontModule = FontModule(context.applicationContext)
        val dimensionsModule = DimensionsModule(runtime, runtime.root)
        val fetchModule = FetchModule(runtime)
        val backHandlerModule = BackHandlerModule(runtime, runtime.root)
        val safeAreaModule = ZynthSafeAreaModule(runtime.root, runtime)

        // Log.d(TAG, "Installing modules into runtime...")
        runtime.installModules(listOf(fontModule, dimensionsModule, fetchModule, backHandlerModule, safeAreaModule))

        // Register the FontRegistry as the asset provider for the core renderer
        runtime.setAssetProvider(FontRegistry)

        // Log.d(TAG, "ZynthAPIs initialized successfully with Font, Dimensions, Fetch, BackHandler, SafeArea")
    }

    /**
     * Clean up (called during app teardown if needed)
     */
    @JvmStatic
    fun cleanup() {
        initializedRuntimes.clear()
    }
}