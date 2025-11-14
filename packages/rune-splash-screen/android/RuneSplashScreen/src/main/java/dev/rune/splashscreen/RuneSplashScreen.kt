package dev.rune.splashscreen

import android.app.Activity
import android.util.Log
import androidx.core.splashscreen.SplashScreen
import com.rune.kit.runtime.RuneRuntime

/**
 * Public interface for RuneSplashScreen module.
 */
object RuneSplashScreen {
    @Volatile private var preventAutoHide: Boolean = false
    @Volatile private var contentReady: Boolean = false
    @Volatile private var bridgeInstalled: Boolean = false

    @JvmStatic
    fun initialize(activity: Activity, runtime: RuneRuntime) {
        if (bridgeInstalled) {
            Log.w("RuneSplashScreen", "Module already initialized")
            return
        }
        runtime.installModules(listOf(RuneSplashScreenModule()))
        bridgeInstalled = true
        Log.d("RuneSplashScreen", "Module initialized")
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
