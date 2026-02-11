package dev.zynth.skia

import com.zynth.kit.runtime.ZynthRuntime

object Skia {
  private var moduleInstance: SkiaModule? = null
  private var nativeLoaded: Boolean = false

  private fun ensureNativeLoaded() {
    if (nativeLoaded) return
    try {
      System.loadLibrary("zynthskia")
      nativeLoaded = true
    } catch (_: Throwable) {
      // Stage 2 bridge is optional; callNativeSync fallback still works.
    }
  }

  @JvmStatic
  fun initialize(runtime: ZynthRuntime) {
    ensureNativeLoaded()
    SkiaBridge.installRuntime(runtime)
    if (moduleInstance != null) {
      return
    }
    val module = SkiaModule()
    runtime.installModules(listOf(module))
    moduleInstance = module
  }

  @JvmStatic
  fun cleanup() {
    moduleInstance?.invalidate()
    moduleInstance = null
    SkiaBridge.clearRuntime()
  }
}
