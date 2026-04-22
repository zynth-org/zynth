package com.zynth.kit.runtime.animate

import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthAnimate module.
 */
object ZynthAnimate {
    private var moduleInstance: ZynthAnimateModule? = null
    private var nativeLoaded: Boolean = false

    private fun ensureNativeLoaded() {
        if (nativeLoaded) return
        try {
            System.loadLibrary("zynthanimate")
            nativeLoaded = true
        } catch (_: Throwable) {
            // Native bindings are optional in phase 1.
        }
    }

    @JvmStatic
    fun initialize(runtime: ZynthRuntime) {
        ensureNativeLoaded()
        runCatching { ZynthAnimateFrameClock.toString() }
        if (moduleInstance != null) {
            android.util.Log.w("ZynthAnimate", "Module already initialized")
            return
        }

        moduleInstance = ZynthAnimateModule(runtime)
        runtime.installModules(listOf(moduleInstance!!))
        android.util.Log.d("ZynthAnimate", "Module initialized")
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance?.onDestroy()
        moduleInstance = null
    }
}
