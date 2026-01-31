package dev.zynth.splashscreen

import android.app.Activity
import android.graphics.drawable.Drawable
import android.util.Log
import android.util.TypedValue
import androidx.core.splashscreen.SplashScreen
import com.zynth.kit.runtime.ZynthRuntime
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/**
 * Public interface for ZynthSplashScreen module.
 */
object ZynthSplashScreen {
    @Volatile private var preventAutoHide: Boolean = false
    @Volatile private var contentReady: Boolean = false
    private val initializedRuntimes = WeakHashMap<ZynthRuntime, Boolean>()
    private var activityRef: WeakReference<Activity>? = null
    private var rootViewRef: WeakReference<android.view.View>? = null
    private var previousRootBackground: Drawable? = null
    private var backgroundRestored: Boolean = false
    private var splashBackgroundColor: Int? = null

    @JvmStatic
    @Suppress("UNUSED_PARAMETER")
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        synchronized(initializedRuntimes) {
            if (initializedRuntimes.containsKey(runtime)) {
                Log.w("ZynthSplashScreen", "Runtime already initialized")
                return
            }
            runtime.installModules(listOf(ZynthSplashScreenModule()))
            activityRef = WeakReference(activity)
            rootViewRef = WeakReference(runtime.root)
            splashBackgroundColor = resolveSplashBackgroundColor(activity)
            applySplashBackground()
            runtime.addSurfaceFirstFrameListener(runtime.rootSurfaceId) {
                markContentReady()
                restoreRootBackground()
            }
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
        restoreRootBackground()
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
        restoreRootBackground()
    }

    private fun applySplashBackground() {
        val color = splashBackgroundColor ?: return
        val root = rootViewRef?.get() ?: return
        if (previousRootBackground == null) {
            previousRootBackground = root.background
        }
        backgroundRestored = false
        root.setBackgroundColor(color)
    }

    private fun restoreRootBackground() {
        if (backgroundRestored) return
        val root = rootViewRef?.get() ?: return
        root.background = previousRootBackground
        backgroundRestored = true
    }

    private fun resolveSplashBackgroundColor(activity: Activity): Int? {
        val theme = activity.theme
        val out = TypedValue()
        if (theme.resolveAttribute(android.R.attr.windowSplashScreenBackground, out, true)) {
            return resolveColor(activity, out)
        }
        if (theme.resolveAttribute(android.R.attr.windowBackground, out, true)) {
            return resolveColor(activity, out)
        }
        if (theme.resolveAttribute(android.R.attr.colorBackground, out, true)) {
            return resolveColor(activity, out)
        }
        return null
    }

    private fun resolveColor(activity: Activity, value: TypedValue): Int? {
        return when {
            value.type in TypedValue.TYPE_FIRST_COLOR_INT..TypedValue.TYPE_LAST_COLOR_INT -> value.data
            value.resourceId != 0 -> activity.resources.getColor(value.resourceId, activity.theme)
            else -> null
        }
    }
}
