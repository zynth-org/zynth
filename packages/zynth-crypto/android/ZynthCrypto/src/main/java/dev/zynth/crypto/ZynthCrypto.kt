package dev.zynth.crypto

import android.app.Activity
import com.zynth.kit.runtime.ZynthRuntime

object ZynthCrypto {
  private var moduleInstance: ZynthCryptoModule? = null

  @JvmStatic
  fun initialize(activity: Activity, runtime: ZynthRuntime) {
    if (moduleInstance != null) {
      return
    }

    val module = ZynthCryptoModule()
    runtime.installModules(listOf(module))
    moduleInstance = module
  }

  @JvmStatic
  fun cleanup() {
    moduleInstance = null
  }
}
