package {{BUNDLE_ID}}

import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.runtime.ZynthRuntime
import java.io.File
import org.json.JSONObject
{{RUNTIME_MODULE_IMPORTS}}
{{MODULE_IMPORTS}}
{{ACTIVITY_HOOK_IMPORTS}}

class MainActivity : AppCompatActivity() {
  private var runtime: ZynthRuntime? = null
  @Volatile private var bundleCode: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    super.onCreate(savedInstanceState)

{{ACTIVITY_ON_CREATE_HOOKS}}

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

    // Ensure IME insets are reported consistently (required for keyboard detection).
    @Suppress("DEPRECATION")
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

    // Initialize SoLoader for Yoga layout engine
    ZynthRuntime.initialize(this)

    val root = ZynthRootView(this, explicitRootId = 0)
    setContentView(root)

    // Capture dev server + devtools intent extras early so native modules can read them.
    val launchIntent = intent
    val devServerUrl = launchIntent.getStringExtra("ZYNTH_DEV_SERVER_URL")
    val devServerToken = launchIntent.getStringExtra("ZYNTH_DEV_SERVER_TOKEN")
    val devtoolsUrl = launchIntent.getStringExtra("ZYNTH_DEVTOOLS_URL")
    val devtoolsToken = launchIntent.getStringExtra("ZYNTH_DEVTOOLS_TOKEN")

    if (!devServerUrl.isNullOrBlank()) {
      System.setProperty("ZYNTH_DEV_SERVER_URL", devServerUrl)
    }
    if (!devServerToken.isNullOrBlank()) {
      System.setProperty("ZYNTH_DEV_SERVER_TOKEN", devServerToken)
    }
    if (!devtoolsUrl.isNullOrBlank()) {
      System.setProperty("ZYNTH_DEVTOOLS_URL", devtoolsUrl)
    }
    if (!devtoolsToken.isNullOrBlank()) {
      System.setProperty("ZYNTH_DEVTOOLS_TOKEN", devtoolsToken)
    }
    persistDevConfig(devServerUrl, devServerToken, devtoolsUrl, devtoolsToken)

    // Start loading bundle in background
    val preloadUrl = devServerUrl
    val loadThread = if (preloadUrl.isNullOrBlank()) {
      Thread {
        try {
          bundleCode = assets.open("main.js").use { it.bufferedReader().readText() }
        } catch (e: Exception) {
          Log.e("MainActivity", "Failed to load bundle", e)
        }
      }.apply { start() }
    } else {
      null
    }

    val runtime = ZynthRuntime(root)
    this.runtime = runtime
{{RUNTIME_MODULE_INSTALLS}}

{{MODULE_INITIALIZERS}}

    if (!devServerUrl.isNullOrBlank()) {
      runtime.connectDevServer(devServerUrl, devServerToken)
    } else {
      // Wait for background thread if needed
      loadThread?.join()
    }

    runtime.loadInitialBundle(assets, preloadedCode = bundleCode)

    // Force a layout pass to ensure window insets are available
    root.post {
      runtime.addSurfaceFirstFrameListener(root.rootId) {
{{ACTIVITY_ON_FIRST_FRAME_HOOKS}}
      }

      Log.i("MainActivity", "Starting runtime")
      runtime.start(root.rootId)
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    runtime?.destroy()
    runtime = null
  }

  private fun persistDevConfig(
    devServerUrl: String?,
    devServerToken: String?,
    devtoolsUrl: String?,
    devtoolsToken: String?
  ) {
    if (devServerUrl.isNullOrBlank() && devtoolsUrl.isNullOrBlank()) return
    try {
      val zynthDir = File(filesDir, ".zynth")
      if (!zynthDir.exists()) {
        zynthDir.mkdirs()
      }
      val configFile = File(zynthDir, "dev-server.json")
      val json = JSONObject()
      if (!devServerUrl.isNullOrBlank()) {
        json.put("url", devServerUrl)
      }
      if (!devServerToken.isNullOrBlank()) {
        json.put("token", devServerToken)
      }
      if (!devtoolsUrl.isNullOrBlank()) {
        json.put("devtoolsUrl", devtoolsUrl)
      }
      if (!devtoolsToken.isNullOrBlank()) {
        json.put("devtoolsToken", devtoolsToken)
      }
      configFile.writeText(json.toString())
    } catch (error: Exception) {
      Log.w("MainActivity", "Failed to persist dev config", error)
    }
  }
}
