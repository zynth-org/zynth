package {{BUNDLE_ID}}

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import {{BUNDLE_ID}}.modules.DeviceModule
import {{BUNDLE_ID}}.modules.EnvModule
import {{BUNDLE_ID}}.modules.PerformanceModule
import com.rune.kit.core.RuneRootView
import com.rune.kit.runtime.RuneRuntime

class MainActivity : AppCompatActivity() {
  private var runtime: RuneRuntime? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Initialize SoLoader for Yoga layout engine
    RuneRuntime.initialize(this)

    val root = RuneRootView(this)
    setContentView(root)

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
    runtime.start(root.rootId)

    this.runtime = runtime
  }

  override fun onDestroy() {
    super.onDestroy()
    runtime?.destroy()
    runtime = null
  }
}
