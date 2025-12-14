package dev.rune.animate

import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneAnimate module.
 */
object RuneAnimate {
    private var moduleInstance: RuneAnimateModule? = null

    @JvmStatic
    fun initialize(runtime: RuneRuntime) {
        if (moduleInstance != null) {
            android.util.Log.w("RuneAnimate", "Module already initialized")
            return
        }

        moduleInstance = RuneAnimateModule(runtime)
        runtime.installModules(listOf(moduleInstance!!))
        android.util.Log.d("RuneAnimate", "Module initialized")
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance?.onDestroy()
        moduleInstance = null
    }
}
