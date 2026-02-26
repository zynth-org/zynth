package dev.zynth.bluetooth

import androidx.activity.ComponentActivity
import com.zynth.kit.runtime.ZynthRuntime

object ZynthBluetooth {
  @JvmStatic
  fun initialize(activity: ComponentActivity, runtime: ZynthRuntime) {
    val module = BluetoothModule(activity, runtime)
    module.setupPermissionLauncher()
    runtime.installModules(listOf(module))
  }
}
