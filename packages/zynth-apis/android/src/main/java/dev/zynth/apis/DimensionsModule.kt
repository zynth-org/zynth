package dev.zynth.apis

import android.content.ComponentCallbacks
import android.content.Context
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Build
import android.os.Looper
import android.util.DisplayMetrics
import android.view.View
import android.view.WindowManager
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import kotlin.math.max
import org.json.JSONObject

private const val DIMENSIONS_EVENT = "zynth.dimensions.change"

private data class DimensionMetrics(
    val width: Double,
    val height: Double,
    val scale: Double,
    val fontScale: Double,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "width" to width,
        "height" to height,
        "scale" to scale,
        "fontScale" to fontScale,
    )

    fun toJson(): JSONObject = JSONObject()
        .put("width", width)
        .put("height", height)
        .put("scale", scale)
        .put("fontScale", fontScale)
}

private data class DimensionsPayload(
    val window: DimensionMetrics,
    val screen: DimensionMetrics,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "window" to window.toMap(),
        "screen" to screen.toMap(),
    )

    fun toJson(): JSONObject = JSONObject()
        .put("window", window.toJson())
        .put("screen", screen.toJson())
}

class DimensionsModule(
    private val runtime: ZynthRuntime,
    private val rootView: ZynthRootView,
) : ZynthModule, ZynthSyncModule, View.OnLayoutChangeListener {

    override val name: String = "Dimensions"

    private val appContext: Context = rootView.context.applicationContext

    @Volatile
    private var latestPayload: DimensionsPayload = computeFallbackPayload()
    private var lastEmitted: DimensionsPayload? = null
    private var callbacksRegistered = false

    private val componentCallbacks = object : ComponentCallbacks {
        override fun onConfigurationChanged(newConfig: Configuration) {
            runOnMainThread {
                emitIfChanged("configuration")
            }
        }

        override fun onLowMemory() {
            // no-op
        }
    }

    override val constants: Map<String, Any>?
        get() {
            // Return current snapshot without starting observation
            // Constants are injected during module registration before JS is ready
            if (Looper.myLooper() == Looper.getMainLooper()) {
                latestPayload = computePayload()
            }
            return latestPayload.toMap()
        }

    override fun initialize() {
        // Start observing immediately to capture layout changes (e.g. from 0 to screen size)
        ensureObserving()
    }

    override fun invalidate() {
        runOnMainThread {
            stopObserving()
        }
    }

    override fun call(method: String, args: ZynthArgs): JSONObject {
        ensureObserving()
        val params = try { args.nestedAt(0) } catch (e: Exception) { null }
        return when (method) {
            "current" -> jsonResponse(capturePayload())
            else -> errorResponse(method)
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        ensureObserving()
        val params = try { args.nestedAt(0) } catch (e: Exception) { null }
        return when (method) {
            "current" -> capturePayload().toMap()
            else -> throw UnsupportedOperationException("Method $method not supported by Dimensions module")
        }
    }

    override fun onLayoutChange(
        v: View,
        left: Int,
        top: Int,
        right: Int,
        bottom: Int,
        oldLeft: Int,
        oldTop: Int,
        oldRight: Int,
        oldBottom: Int,
    ) {
        emitIfChanged("layout")
    }

    private fun ensureObserving() {
        if (!callbacksRegistered) {
            runOnMainThread {
                startObserving()
            }
        }
    }

    private fun startObserving() {
        if (callbacksRegistered) return
        stopObserving()
        rootView.addOnLayoutChangeListener(this)
        if (!callbacksRegistered) {
            appContext.registerComponentCallbacks(componentCallbacks)
            callbacksRegistered = true
        }
        emitIfChanged("initial")
    }

    private fun stopObserving() {
        rootView.removeOnLayoutChangeListener(this)
        if (callbacksRegistered) {
            appContext.unregisterComponentCallbacks(componentCallbacks)
            callbacksRegistered = false
        }
    }

    private fun emitIfChanged(@Suppress("UNUSED_PARAMETER") reason: String) {
        val payload = computePayload()
        if (lastEmitted == payload) {
            return
        }
        lastEmitted = payload
        latestPayload = payload
        runtime.emitEvent(DIMENSIONS_EVENT, payload.toMap())
    }

    private fun capturePayload(): DimensionsPayload {
        return if (Looper.myLooper() == Looper.getMainLooper()) {
            val payload = computePayload()
            latestPayload = payload
            payload
        } else {
            latestPayload
        }
    }

    private fun computePayload(): DimensionsPayload {
        val resources = rootView.resources
        val density = resources.displayMetrics.density.toDouble()
        val fontScale = resources.configuration.fontScale.toDouble()

        val windowWidthPx = max(rootView.width, 0)
        val windowHeightPx = max(rootView.height, 0)
        
        var wPx = if (windowWidthPx > 0) windowWidthPx else resources.displayMetrics.widthPixels
        var hPx = if (windowHeightPx > 0) windowHeightPx else resources.displayMetrics.heightPixels

        if (wPx <= 0 || hPx <= 0) {
            val sys = android.content.res.Resources.getSystem().displayMetrics
            if (wPx <= 0) wPx = sys.widthPixels
            if (hPx <= 0) hPx = sys.heightPixels
        }
        
        // android.util.Log.d("DimensionsModule", "computePayload: widthPx=$wPx, heightPx=$hPx")

        val windowMetrics = DimensionMetrics(
            width = wPx.toDouble() / density,
            height = hPx.toDouble() / density,
            scale = density,
            fontScale = fontScale,
        )

        val (screenWidthPx, screenHeightPx) = determineScreenPixels()
        val screenMetrics = DimensionMetrics(
            width = screenWidthPx.toDouble() / density,
            height = screenHeightPx.toDouble() / density,
            scale = density,
            fontScale = fontScale,
        )

        return DimensionsPayload(windowMetrics, screenMetrics)
    }

    private fun determineScreenPixels(): Pair<Int, Int> {
        val wm = rootView.context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds: Rect? = wm?.maximumWindowMetrics?.bounds
            if (bounds != null && bounds.width() > 0 && bounds.height() > 0) {
                return bounds.width() to bounds.height()
            }
        } else {
            @Suppress("DEPRECATION")
            val display = wm?.defaultDisplay
            if (display != null) {
                val dm = DisplayMetrics()
                @Suppress("DEPRECATION")
                display.getRealMetrics(dm)
                if (dm.widthPixels > 0 && dm.heightPixels > 0) {
                    return dm.widthPixels to dm.heightPixels
                }
            }
        }

        val metrics = rootView.resources.displayMetrics
        if (metrics.widthPixels > 0 && metrics.heightPixels > 0) {
            return metrics.widthPixels to metrics.heightPixels
        }

        val systemMetrics = android.content.res.Resources.getSystem().displayMetrics
        return systemMetrics.widthPixels to systemMetrics.heightPixels
    }

    private fun computeFallbackPayload(): DimensionsPayload {
        val resources = rootView.resources
        val density = resources.displayMetrics.density.toDouble()
        val fontScale = resources.configuration.fontScale.toDouble()
        val (screenWidthPx, screenHeightPx) = determineScreenPixels()

        val screenMetrics = DimensionMetrics(
            width = screenWidthPx.toDouble() / density,
            height = screenHeightPx.toDouble() / density,
            scale = density,
            fontScale = fontScale,
        )

        var wPx = resources.displayMetrics.widthPixels
        var hPx = resources.displayMetrics.heightPixels
        
        if (wPx <= 0 || hPx <= 0) {
            val sys = android.content.res.Resources.getSystem().displayMetrics
            if (wPx <= 0) wPx = sys.widthPixels
            if (hPx <= 0) hPx = sys.heightPixels
        }

        val windowMetrics = DimensionMetrics(
            width = wPx.toDouble() / density,
            height = hPx.toDouble() / density,
            scale = density,
            fontScale = fontScale,
        )

        return DimensionsPayload(windowMetrics, screenMetrics)
    }

    private fun runOnMainThread(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            rootView.post(block)
        }
    }

    private fun jsonResponse(payload: DimensionsPayload): JSONObject {
        return JSONObject()
            .put("ok", true)
            .put("result", payload.toJson())
    }

    private fun errorResponse(method: String): JSONObject {
        return JSONObject()
            .put("ok", false)
            .put("error", "unknown_method")
            .put("method", method)
    }
}
