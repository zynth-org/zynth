package dev.zynth.skia

import com.zynth.kit.runtime.ZynthRuntime

object Skia {
    @JvmStatic
    fun initialize(runtime: ZynthRuntime) {
        val module = SkiaModule()
        runtime.installModules(listOf(module))
    }
}