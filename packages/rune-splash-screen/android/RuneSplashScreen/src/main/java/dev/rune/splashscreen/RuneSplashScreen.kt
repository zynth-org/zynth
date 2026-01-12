package dev.rune.splashscreen

import android.app.Activity
import android.util.Log
import androidx.core.splashscreen.SplashScreen
import com.rune.kit.runtime.RuneRuntime
import java.util.WeakHashMap

/**
 * Public interface for RuneSplashScreen module.
 */
object RuneSplashScreen {
    @Volatile private var preventAutoHide: Boolean = false
    @Volatile private var contentReady: Boolean = false
    private val initializedRuntimes = WeakHashMap<RuneRuntime, Boolean>()

    @JvmStatic
    @Suppress("UNUSED_PARAMETER")
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        synchronized(initializedRuntimes) {
            if (initializedRuntimes.containsKey(runtime)) {
                Log.w("RuneSplashScreen", "Runtime already initialized")
                return
            }
            runtime.installModules(listOf(RuneSplashScreenModule()))
            initializedRuntimes[runtime] = true
            Log.d("RuneSplashScreen", "Module initialized")
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
