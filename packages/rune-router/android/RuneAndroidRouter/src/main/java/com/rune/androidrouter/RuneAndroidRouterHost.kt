package com.rune.androidrouter

import android.app.Activity
import android.util.Log
import android.view.View
import androidx.fragment.app.FragmentActivity
import com.rune.kit.core.RuneRootView
import com.rune.kit.runtime.RuneRuntime

object RuneAndroidRouterHost {
    private var navigationContainer: RuneNavigationContainer? = null
    private var runtimeRef: RuneRuntime? = null

    @JvmStatic
    fun bootstrap(activity: Activity, runtime: RuneRuntime, rootView: View): Boolean {
        if (activity !is FragmentActivity) {
            Log.w(TAG, "Activity must extend FragmentActivity for router support")
            return false
        }
        val runeRoot = rootView as? RuneRootView
        if (runeRoot == null) {
            Log.w(TAG, "bootstrap expected RuneRootView, got ${rootView::class.java.simpleName}")
            return false
        }
        if (navigationContainer != null) {
            Log.i(TAG, "RuneAndroidRouter already attached")
            return true
        }

        val container = RuneNavigationContainer(activity, runtime, runeRoot)
        container.attachToActivity()
        runtime.installModules(listOf(RuneAndroidRouterBridge(container)))
        flagNativeRouterActive(runtime)
        navigationContainer = container
        runtimeRef = runtime
        Log.i(TAG, "RuneAndroidRouter bootstrap complete")
        return true
    }

    internal fun requireRuntime(): RuneRuntime =
        runtimeRef ?: error("RuneAndroidRouter runtime not initialized")

    internal fun runtimeOrNull(): RuneRuntime? = runtimeRef

    internal fun containerOrNull(): RuneNavigationContainer? = navigationContainer

    @JvmStatic
    fun isAttached(): Boolean = navigationContainer != null

    private fun flagNativeRouterActive(runtime: RuneRuntime) {
        val script = """
            (function(){
              globalThis.__RUNE_NATIVE_ROUTER_ACTIVE = true;
            })();
        """.trimIndent()
        runtime.evaluateAsync(script)
    }

    private const val TAG = "RuneAndroidRouterHost"
}
