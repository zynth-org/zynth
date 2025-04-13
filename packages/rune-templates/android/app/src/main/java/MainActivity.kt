package {{BUNDLE_ID}}

import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import {{BUNDLE_ID}}.modules.DeviceModule
import {{BUNDLE_ID}}.modules.EnvModule
import {{BUNDLE_ID}}.modules.PerformanceModule
import com.rune.kit.core.RuneRootView
import com.rune.kit.runtime.RuneRuntime
{{MODULE_IMPORTS}}

class MainActivity : AppCompatActivity() {
  private var runtime: RuneRuntime? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Enable edge-to-edge display
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
      window.setDecorFitsSystemWindows(false)
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = (
        android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
      )
    }

    // Initialize SoLoader for Yoga layout engine
    RuneRuntime.initialize(this)

    val root = RuneRootView(this)

    // Force a layout pass to ensure window insets are available
    root.post {
      val runtime = RuneRuntime(root)
      runtime.installDefaultModules()
      runtime.installModules(listOf(DeviceModule(), EnvModule(), PerformanceModule()))

      intent?.let { launchIntent ->
        val url = launchIntent.getStringExtra("RUNE_DEV_SERVER_URL")
        if (!url.isNullOrBlank()) {
          val token = launchIntent.getStringExtra("RUNE_DEV_SERVER_TOKEN")
          runtime.connectDevServer(url, token)
        }
      }

      runtime.loadInitialBundle(assets)

{{MODULE_INITIALIZERS}}

      val routerAttached = bootstrapNativeRouter(runtime, root)
      if (!routerAttached) {
        setContentView(root)
      }

      runtime.start(root.rootId)

      this@MainActivity.runtime = runtime
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    runtime?.destroy()
    runtime = null
  }

  private fun bootstrapNativeRouter(runtime: RuneRuntime, rootView: RuneRootView): Boolean {
    try {
      val hostClass = Class.forName("com.rune.router.RuneRouterHost")
      val method = hostClass.getMethod(
        "bootstrap",
        android.app.Activity::class.java,
        RuneRuntime::class.java,
        android.view.View::class.java
      )
      val result = method.invoke(null, this, runtime, rootView) as? Boolean
      if (result == true) {
        return true
      }
    } catch (_: ClassNotFoundException) {
      // Router package not linked; ignore.
    } catch (error: Throwable) {
      Log.w("RuneRouterHost", "Bootstrap failed", error)
    }
    return false
  }
}
