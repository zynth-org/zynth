package dev.zynth.ui

import android.app.Activity
import android.content.res.Configuration
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Backward-compatible bootstrap alias.
 * Prefer using `ZynthUIBootstrap`.
 */
object ZynthAppearance {
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        ZynthUIBootstrap.initialize(activity, runtime)
    }

    @JvmStatic
    fun onConfigurationChanged(newConfig: Configuration) {
        ZynthUIBootstrap.onConfigurationChanged(newConfig)
    }

    @JvmStatic
    fun cleanup() {
        ZynthUIBootstrap.cleanup()
    }
}
