package {{BUNDLE_ID}}

import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.runtime.ZynthRuntime
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
{{RUNTIME_MODULE_IMPORTS}}
{{MODULE_IMPORTS}}
{{ACTIVITY_HOOK_IMPORTS}}

class MainActivity : AppCompatActivity() {
  private var runtime: ZynthRuntime? = null
  @Volatile private var bundleCode: String? = null
  @Volatile private var bundleBytecode: ByteArray? = null

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
    var devServerUrl = launchIntent.getStringExtra("ZYNTH_DEV_SERVER_URL")
    var devServerToken = launchIntent.getStringExtra("ZYNTH_DEV_SERVER_TOKEN")
    var devtoolsUrl = launchIntent.getStringExtra("ZYNTH_DEVTOOLS_URL")
    var devtoolsToken = launchIntent.getStringExtra("ZYNTH_DEVTOOLS_TOKEN")

    val persistedConfig = loadPersistedDevConfig()
    if (devServerUrl.isNullOrBlank()) {
      devServerUrl = persistedConfig?.url
    }
    if (devServerToken.isNullOrBlank()) {
      devServerToken = persistedConfig?.token
    }
    if (devtoolsUrl.isNullOrBlank()) {
      devtoolsUrl = persistedConfig?.devtoolsUrl
    }
    if (devtoolsToken.isNullOrBlank()) {
      devtoolsToken = persistedConfig?.devtoolsToken
    }

    val buildConfigDevServerUrl = BuildConfig.ZYNTH_DEV_SERVER_URL.takeIf { it.isNotBlank() }
    if (devServerUrl.isNullOrBlank()) {
      devServerUrl = buildConfigDevServerUrl
    }
    val buildConfigDevServerToken = BuildConfig.ZYNTH_DEV_SERVER_TOKEN.takeIf { it.isNotBlank() }
    if (devServerToken.isNullOrBlank()) {
      devServerToken = buildConfigDevServerToken
    }

    // Allow forcing local bundle loading via Intent extra (useful for testing bytecode in Debug)
    if (launchIntent.getBooleanExtra("ZYNTH_FORCE_LOCAL_BUNDLE", false)) {
      Log.i("MainActivity", "ZYNTH_FORCE_LOCAL_BUNDLE is set. Ignoring dev server URL.")
      devServerUrl = null
    }

    if (!BuildConfig.DEBUG) {
      // In release builds, force dev server URL to null to ensure we load from assets (bytecode/bundle)
      // unless it was explicitly passed via Intent (e.g. for specialized testing).
      // The Intent check happened earlier; if launchIntent didn't have it, we clear it here.
      if (launchIntent.getStringExtra("ZYNTH_DEV_SERVER_URL").isNullOrBlank()) {
        devServerUrl = null
      }
    } else {
      if (devServerUrl.isNullOrBlank()) {
        devServerUrl = if (isEmulator()) "http://10.0.2.2:8081" else null
      }
    }

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
    val loadThread = Thread {
      try {
        if (!preloadUrl.isNullOrBlank()) {
          val bundleUrl = URL("${preloadUrl.trimEnd('/')}/main.js")
          val connection = bundleUrl.openConnection() as HttpURLConnection
          connection.connectTimeout = 8000
          connection.readTimeout = 8000
          connection.inputStream.use { input ->
            bundleCode = input.bufferedReader().readText()
          }
        } else {
          // Try loading bytecode first
          try {
            assets.open("main.hbc").use { bundleBytecode = it.readBytes() }
            Log.i("MainActivity", "Loaded main.hbc from assets")
          } catch (e: java.io.IOException) {
            // Fallback to JS bundle
            try {
              assets.open("main.js").use { bundleCode = it.bufferedReader().readText() }
              Log.i("MainActivity", "Loaded main.js from assets (bytecode not found)")
            } catch (e2: java.io.IOException) {
              Log.e("MainActivity", "Failed to load both main.hbc and main.js from assets", e2)
              throw e2 // Rethrow to hit outer catch if needed, though we already logged it
            }
          }
        }
      } catch (e: Exception) {
        Log.e("MainActivity", "Failed to load bundle", e)
      }
    }.apply { start() }

    val runtime = ZynthRuntime(root)
    this.runtime = runtime
{{RUNTIME_MODULE_INSTALLS}}

{{MODULE_INITIALIZERS}}

    if (!devServerUrl.isNullOrBlank()) {
      runtime.connectDevServer(devServerUrl, devServerToken)
    }
    loadThread.join()

    runtime.loadInitialBundle(assets, preloadedCode = bundleCode, preloadedBytecode = bundleBytecode)

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

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
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

  private data class DevConfig(
    val url: String?,
    val token: String?,
    val devtoolsUrl: String?,
    val devtoolsToken: String?
  )

  private fun loadPersistedDevConfig(): DevConfig? {
    return try {
      val configFile = File(filesDir, ".zynth/dev-server.json")
      if (!configFile.exists()) {
        return null
      }
      val json = JSONObject(configFile.readText())
      DevConfig(
        url = json.optString("url").takeIf { it.isNotBlank() },
        token = json.optString("token").takeIf { it.isNotBlank() },
        devtoolsUrl = json.optString("devtoolsUrl").takeIf { it.isNotBlank() },
        devtoolsToken = json.optString("devtoolsToken").takeIf { it.isNotBlank() }
      )
    } catch (error: Exception) {
      Log.w("MainActivity", "Failed to read dev config", error)
      null
    }
  }

  private fun isEmulator(): Boolean {
    val fingerprint = android.os.Build.FINGERPRINT.lowercase()
    val model = android.os.Build.MODEL.lowercase()
    return fingerprint.contains("generic") ||
      fingerprint.contains("emulator") ||
      model.contains("emulator") ||
      model.contains("android sdk built for")
  }
}
