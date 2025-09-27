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
{{MODULE_IMPORTS}}

class MainActivity : AppCompatActivity() {
  private var runtime: RuneRuntime? = null
  private var isReady = false
  @Volatile private var bundleCode: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    super.onCreate(savedInstanceState)

    splashScreen.setKeepOnScreenCondition { !isReady }

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

    // Disable automatic keyboard handling - let JS handle it via KeyboardAvoidingView
    // This prevents the system from panning/resizing when keyboard appears
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)

    // Initialize SoLoader for Yoga layout engine
    RuneRuntime.initialize(this)

    val root = RuneRootView(this, explicitRootId = 0)
    setContentView(root)

    // Start loading bundle in background
    val launchIntent = intent
    val preloadUrl = launchIntent?.getStringExtra("RUNE_DEV_SERVER_URL")
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

    // Force a layout pass to ensure window insets are available
    root.post {
      val runtime = RuneRuntime(root)
      runtime.installDefaultModules()
      runtime.installModules(listOf(DeviceModule(), EnvModule(), PerformanceModule()))

{{MODULE_INITIALIZERS}}

      val currentIntent = intent
      val devServerUrl = currentIntent?.getStringExtra("RUNE_DEV_SERVER_URL")

      if (!devServerUrl.isNullOrBlank()) {
        val token = currentIntent?.getStringExtra("RUNE_DEV_SERVER_TOKEN")
        runtime.connectDevServer(devServerUrl, token)
      } else {
        // Wait for background thread if needed
        loadThread?.join()
      }

      runtime.loadInitialBundle(assets, preloadedCode = bundleCode)

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
        isReady = true
      }
      
      // ALWAYS start the runtime - router or not
      Log.i("MainActivity", "Starting runtime (router=${routerAttached})")
      runtime.start(root.rootId)
      
      this.runtime = runtime
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
}
