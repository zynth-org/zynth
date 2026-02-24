package dev.zynth.webbrowser

import androidx.activity.ComponentActivity
import com.zynth.kit.runtime.ZynthRuntime

object ZynthWebBrowser {
  @JvmStatic
  fun initialize(activity: ComponentActivity, runtime: ZynthRuntime) {
    runtime.installModules(listOf(WebBrowserModule(activity, runtime)))
  }
}
