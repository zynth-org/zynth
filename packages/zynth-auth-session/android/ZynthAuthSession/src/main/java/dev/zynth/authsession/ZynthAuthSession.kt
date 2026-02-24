package dev.zynth.authsession

import androidx.activity.ComponentActivity
import com.zynth.kit.runtime.ZynthRuntime

object ZynthAuthSession {
  @JvmStatic
  fun initialize(activity: ComponentActivity, runtime: ZynthRuntime) {
    val module = AuthSessionModule(activity, runtime)
    runtime.installModules(listOf(module))
  }
}
