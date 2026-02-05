package dev.zynth.automation

import android.app.Activity
import com.zynth.kit.runtime.ZynthRuntime

@Suppress("unused")
object ZynthAutomation {
    private var moduleInstance: ZynthAutomationModule? = null

    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        activity
        if (moduleInstance != null) {
            return
        }
        val module = ZynthAutomationModule(runtime)
        moduleInstance = module
        runtime.installModules(listOf(module))
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
