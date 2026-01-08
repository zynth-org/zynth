package {{BUNDLE_ID}}

import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import {{BUNDLE_ID}}.modules.DeviceModule
import {{BUNDLE_ID}}.modules.EnvModule
import {{BUNDLE_ID}}.modules.PerformanceModule
import com.rune.kit.core.RuneRootView
import com.rune.kit.runtime.RuneRuntime
import java.io.File
import org.json.JSONObject
{{MODULE_IMPORTS}}
{{ACTIVITY_HOOK_IMPORTS}}

class MainActivity : AppCompatActivity() {
  private var runtime: RuneRuntime? = null
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
    RuneRuntime.initialize(this)

    val root = RuneRootView(this, explicitRootId = 0)
    setContentView(root)

    // Capture dev server + devtools intent extras early so native modules can read them.
    val launchIntent = intent
    val devServerUrl = launchIntent.getStringExtra("RUNE_DEV_SERVER_URL")
    val devServerToken = launchIntent.getStringExtra("RUNE_DEV_SERVER_TOKEN")
    val devtoolsUrl = launchIntent.getStringExtra("RUNE_DEVTOOLS_URL")
    val devtoolsToken = launchIntent.getStringExtra("RUNE_DEVTOOLS_TOKEN")

    if (!devtoolsUrl.isNullOrBlank()) {
      System.setProperty("RUNE_DEVTOOLS_URL", devtoolsUrl)
    }
    if (!devtoolsToken.isNullOrBlank()) {
      System.setProperty("RUNE_DEVTOOLS_TOKEN", devtoolsToken)
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

    val runtime = RuneRuntime(root)
    this.runtime = runtime
    runtime.installDefaultModules()
    runtime.installModules(listOf(DeviceModule(), EnvModule(), PerformanceModule()))

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
      // Try to bootstrap router BEFORE starting runtime
      val routerAttached = try {
        bootstrapNativeRouter(runtime, root)
      } catch (e: Exception) {
        Log.w("MainActivity", "Router bootstrap failed", e)
        false
      }

      if (!routerAttached) {
        // No router - keep root as content view
        setContentView(root)
      }

    runtime.addSurfaceFirstFrameListener(root.rootId) {
{{ACTIVITY_ON_FIRST_FRAME_HOOKS}}
    }
      
      // ALWAYS start the runtime - router or not
      Log.i("MainActivity", "Starting runtime (router=${routerAttached})")
      runtime.start(root.rootId)
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    runtime?.destroy()
    runtime = null
  }

  private fun bootstrapNativeRouter(runtime: RuneRuntime, rootView: RuneRootView): Boolean {
    // TOGGLE THIS FLAG TO TEST MINIMAL FRAGMENT APPROACH
    val USE_MINIMAL_TEST = false

    try {
      val hostClass = Class.forName("com.rune.androidrouter.RuneAndroidRouterHost")
      val method = hostClass.getMethod("isAttached")
      val attached = method.invoke(null) as? Boolean
      if (attached == true) {
        Log.i("MainActivity", "RuneAndroidRouter already attached; skipping legacy bootstrap")
        return true
      }
    } catch (_: ClassNotFoundException) {
      // RuneAndroidRouter not linked; fallthrough to legacy router bootstrap
    } catch (error: Throwable) {
      Log.w("MainActivity", "RuneAndroidRouterHost introspection failed", error)
    }

    try {
      if (USE_MINIMAL_TEST) {
        Log.i("MainActivity", "=== USING MINIMAL TEST MODE ===")
        val hostClass = Class.forName("com.rune.router.RuneRouterTestHost")
        val method = hostClass.getMethod(
          "bootstrapMinimalTest",
          android.app.Activity::class.java,
          RuneRuntime::class.java,
          android.view.View::class.java
        )
        val result = method.invoke(null, this, runtime, rootView) as? Boolean
        if (result == true) {
          return true
        }
      } else {
        Log.i("MainActivity", "=== USING FULL ROUTER ===")
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
      }
    } catch (_: ClassNotFoundException) {
      // Router package not linked; ignore.
    } catch (error: Throwable) {
      Log.w("MainActivity", "Bootstrap failed", error)
    }
    return false
  }

  private fun persistDevConfig(
    devServerUrl: String?,
    devServerToken: String?,
    devtoolsUrl: String?,
    devtoolsToken: String?
  ) {
    if (devServerUrl.isNullOrBlank() && devtoolsUrl.isNullOrBlank()) return
    try {
      val runeDir = File(filesDir, ".rune")
      if (!runeDir.exists()) {
        runeDir.mkdirs()
      }
      val configFile = File(runeDir, "dev-server.json")
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
