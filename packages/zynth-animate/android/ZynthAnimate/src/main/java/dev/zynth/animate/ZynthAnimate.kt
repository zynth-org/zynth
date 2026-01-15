package dev.zynth.animate

import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthAnimate module.
 */
object ZynthAnimate {
    private var moduleInstance: ZynthAnimateModule? = null

    @JvmStatic
    fun initialize(runtime: ZynthRuntime) {
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
