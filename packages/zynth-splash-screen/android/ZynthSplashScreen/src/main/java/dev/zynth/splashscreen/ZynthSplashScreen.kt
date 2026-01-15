package dev.zynth.splashscreen

import android.app.Activity
import android.util.Log
import androidx.core.splashscreen.SplashScreen
import com.zynth.kit.runtime.ZynthRuntime
import java.util.WeakHashMap

/**
 * Public interface for ZynthSplashScreen module.
 */
object ZynthSplashScreen {
    @Volatile private var preventAutoHide: Boolean = false
    @Volatile private var contentReady: Boolean = false
    private val initializedRuntimes = WeakHashMap<ZynthRuntime, Boolean>()

    @JvmStatic
    @Suppress("UNUSED_PARAMETER")
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        synchronized(initializedRuntimes) {
            if (initializedRuntimes.containsKey(runtime)) {
                Log.w("ZynthSplashScreen", "Runtime already initialized")
                return
            }
            runtime.installModules(listOf(ZynthSplashScreenModule()))
            initializedRuntimes[runtime] = true
            Log.d("ZynthSplashScreen", "Module initialized")
        }
    }

    @JvmStatic
    fun resetForLaunch() {
        contentReady = false
        preventAutoHide = false
    }

    @JvmStatic
    fun attach(splashScreen: SplashScreen) {
        resetForLaunch()
        splashScreen.setKeepOnScreenCondition { shouldKeepOnScreen() }
    }

    @JvmStatic
    fun markContentReady() {
        contentReady = true
    }

    @JvmStatic
    fun shouldKeepOnScreen(): Boolean {
        return preventAutoHide || !contentReady
    }

    @JvmStatic
    fun preventAutoHide() {
        preventAutoHide = true
    }

    @JvmStatic
    fun hide() {
        preventAutoHide = false
        contentReady = true
    }
}
