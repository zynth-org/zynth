package dev.zynth.skia

import android.app.Activity
import com.zynth.kit.runtime.ZynthRuntime

object Skia {
    private var nativeLoaded: Boolean = false

    private fun ensureNativeLoaded() {
        if (nativeLoaded) return
        try {
            System.loadLibrary("zynthskia")
            nativeLoaded = true
        } catch (_: Throwable) {
            // JSI plugin is optional during early bring-up.
        }
    }

    @JvmStatic
    fun initialize(runtime: ZynthRuntime) {
        ensureNativeLoaded()
        runCatching { ZynthSkiaJSI.toString() }
        val module = SkiaModule()
        runtime.installModules(listOf(module))
    }

    // Compatibility overload for previously generated apps that call initialize(activity, runtime).
    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        activity
        initialize(runtime)
    }
}
