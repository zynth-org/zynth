package dev.zynth.{{MODULE_NAME}}

import com.zynth.kit.runtime.ZynthRuntime

object {{MODULE_NAME_PASCAL}} {
    @JvmStatic
    fun initialize(runtime: ZynthRuntime) {
        val module = {{MODULE_NAME_PASCAL}}Module()
        runtime.installModules(listOf(module))
    }
}