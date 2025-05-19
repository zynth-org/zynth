package com.rune.androidrouter

import android.graphics.Color
import android.os.Looper
import android.util.Log
import android.view.View
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import com.rune.bottomsheet.BottomSheetSnapPoint
import com.rune.bottomsheet.RuneBottomSheetDialog
import com.rune.kit.core.RuneRootView
import org.json.JSONObject

internal class BottomSheetNavigatorHost(
    private val activity: FragmentActivity,
) {

    private var config: RouterBottomSheetNavigatorConfig? = null
    private val routeStack = mutableListOf<BottomSheetScene>()
    private var dialog: RuneBottomSheetDialog? = null
    private var contentHost: FrameLayout? = null
    private var suppressDismissCallback = false
    private val sceneBySurfaceId = mutableMapOf<Int, BottomSheetScene>()

    fun register(config: RouterBottomSheetNavigatorConfig) {
        runOnUiThread {
            this.config = config
            Log.i(TAG, "Registered bottom sheet navigator screens=${config.screens.map { it.name }}")
            clearStack()
            val initialRoute = config.initialRouteName
            if (initialRoute != null && hasRoute(initialRoute)) {
                Log.d(TAG, "Opening bottom sheet initialRoute=$initialRoute")
                pushRoute(initialRoute, null, animated = false)
            } else {
                if (initialRoute != null) {
                    Log.w(TAG, "Initial bottom sheet route $initialRoute not registered; sheet hidden")
                }
                dismissDialogImmediate()
            }
        }
    }

    fun hasRoute(routeName: String): Boolean {
        return config?.screens?.any { it.name == routeName } == true
    }

    fun handleNavigate(routeName: String, params: JSONObject?): Boolean {
        if (!hasRoute(routeName)) {
            return false
        }
        runOnUiThread {
            pushRoute(routeName, params, animated = true)
        }
        return true
    }

    fun handleGoBack(): Boolean {
        if (routeStack.isEmpty()) {
            return false
        }
        runOnUiThread {
            if (!popRoute()) {
                dismissSheet()
            }
        }
        return true
    }

    private fun pushRoute(routeName: String, params: JSONObject?, animated: Boolean) {
        val config = this.config
        if (config == null) {
            Log.w(TAG, "pushRoute($routeName) ignored; config missing")
            return
        }
        val screenRegistered = config.screens.any { it.name == routeName }
        if (!screenRegistered) {
            Log.w(TAG, "pushRoute($routeName) failed; route not registered")
            return
        }
        val host = ensureContentHost()
        val deferVisibility = routeStack.isNotEmpty()
        val scene = BottomSheetScene(routeName, params, deferVisibility)
        Log.d(TAG, "pushRoute route=$routeName params=$params stackSize=${routeStack.size + 1}")
        routeStack.add(scene)
        host.addView(
            scene.rootView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        )
        scene.render()
        val options = resolveOptionsForRoute(routeName)
        applySheetOptions(options)
        val dialog = ensureDialog()
        if (!dialog.isShowing) {
            dialog.present(options.initialSnapIndex, animated)
        } else {
            dialog.snapTo(options.initialSnapIndex)
        }
    }

    private fun popRoute(): Boolean {
        if (routeStack.isEmpty()) {
            return false
        }
        val removed = routeStack.removeAt(routeStack.lastIndex)
        removed.dispose(contentHost)
        val previous = routeStack.lastOrNull()
        if (previous != null) {
            previous.show()
            val options = resolveOptionsForRoute(previous.routeName)
            applySheetOptions(options)
            dialog?.snapTo(options.initialSnapIndex)
            Log.d(TAG, "popRoute route=${removed.routeName} -> previous=${previous.routeName}")
            return true
        }
        Log.d(TAG, "popRoute route=${removed.routeName} -> no previous route")
        return false
    }

    private fun resolveOptionsForRoute(routeName: String): ResolvedSheetOptions {
        val navigatorOptions = config?.options
        val screenOptions = config?.screens
            ?.firstOrNull { it.name == routeName }
            ?.options

        val snapPoints = convertSnapPoints(screenOptions?.snapPoints ?: navigatorOptions?.snapPoints)
        val initialSnapIndex = (screenOptions?.initialSnapIndex ?: navigatorOptions?.initialSnapIndex)
            ?.coerceAtLeast(0) ?: DEFAULT_INITIAL_SNAP_INDEX
        val overlayColor = screenOptions?.overlayColor
            ?: navigatorOptions?.overlayColor
            ?: DEFAULT_OVERLAY_COLOR
        val overlayOpacity = (screenOptions?.overlayOpacity ?: navigatorOptions?.overlayOpacity
            ?: DEFAULT_OVERLAY_OPACITY).coerceIn(0f, 1f)
        val dismissOnOverlayPress = screenOptions?.dismissOnOverlayPress
            ?: navigatorOptions?.dismissOnOverlayPress
            ?: DEFAULT_DISMISS_ON_OVERLAY_PRESS

        return ResolvedSheetOptions(
            snapPoints = snapPoints,
            initialSnapIndex = initialSnapIndex,
            overlayColor = overlayColor,
            overlayOpacity = overlayOpacity,
            dismissOnOverlayPress = dismissOnOverlayPress,
        )
    }

    private fun convertSnapPoints(points: List<RouterBottomSheetSnapPoint>?): List<BottomSheetSnapPoint> {
        if (points.isNullOrEmpty()) {
            return emptyList()
        }
        return points.mapNotNull { snapPoint ->
            when (snapPoint) {
                is RouterBottomSheetSnapPoint.Absolute -> BottomSheetSnapPoint.Absolute(snapPoint.value)
                is RouterBottomSheetSnapPoint.Percent -> BottomSheetSnapPoint.Percent(snapPoint.value)
            }
        }
    }

    private fun applySheetOptions(options: ResolvedSheetOptions) {
        val dialog = ensureDialog()
        dialog.setSnapPoints(options.snapPoints)
        dialog.setOverlayColor(options.overlayColor)
        dialog.setOverlayOpacity(options.overlayOpacity)
        dialog.setDismissOnOverlayPress(options.dismissOnOverlayPress)
    }

    private fun ensureDialog(): RuneBottomSheetDialog {
        var dialog = this.dialog
        if (dialog == null) {
            val host = ensureContentHost()
            dialog = RuneBottomSheetDialog(activity, host).also { sheetDialog ->
                sheetDialog.listener = object : RuneBottomSheetDialog.Listener {
                    override fun onShow() {
                        // no-op
                    }

                    override fun onDismiss() {
                        if (suppressDismissCallback) {
                            suppressDismissCallback = false
                            return
                        }
                        clearStack()
                    }

                    override fun onSlide(sheet: View, slideOffset: Float) {
                        // Observers can be added later if needed.
                    }

                    override fun onStateChanged(sheet: View, newState: Int) {
                        // no-op for now
                    }
                }
            }
            this.dialog = dialog
        }
        return dialog
    }

    private fun ensureContentHost(): FrameLayout {
        var host = contentHost
        if (host == null) {
            host = FrameLayout(activity).apply {
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                )
            }
            contentHost = host
        }
        return host
    }

    private fun clearStack() {
        val host = contentHost
        routeStack.toList().forEach { scene ->
            scene.dispose(host)
        }
        routeStack.clear()
        sceneBySurfaceId.clear()
        host?.removeAllViews()
    }

    private fun dismissDialogImmediate() {
        val dialog = dialog ?: return
        if (!dialog.isShowing) {
            return
        }
        suppressDismissCallback = true
        dialog.dismiss()
    }

    private fun dismissSheet() {
        dialog?.dismissSheet()
    }

    fun notifyScreenRendered(surfaceId: Int): Boolean {
        val scene = sceneBySurfaceId[surfaceId] ?: return false
        scene.markContentRendered()
        return true
    }

    private fun registerSceneSurface(surfaceId: Int, scene: BottomSheetScene) {
        sceneBySurfaceId[surfaceId] = scene
    }

    private fun unregisterSceneSurface(surfaceId: Int) {
        sceneBySurfaceId.remove(surfaceId)
    }

    private fun handleSceneReady(scene: BottomSheetScene) {
        val index = routeStack.indexOf(scene)
        if (index > 0) {
            routeStack[index - 1].hide()
        }
    }

    private fun runOnUiThread(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            activity.runOnUiThread(block)
        }
    }

    private data class ResolvedSheetOptions(
        val snapPoints: List<BottomSheetSnapPoint>,
        val initialSnapIndex: Int,
        val overlayColor: Int,
        val overlayOpacity: Float,
        val dismissOnOverlayPress: Boolean,
    )

    private inner class BottomSheetScene(
        val routeName: String,
        params: JSONObject?,
        deferVisibility: Boolean,
    ) {
        val rootView: RuneRootView = RuneRootView(activity)
        private val paramsExpression: String = params?.toString() ?: "null"
        private var disposed = false
        private var ready = false
        private var handledReady = false

        init {
            rootView.layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
            rootView.visibility = if (deferVisibility) View.INVISIBLE else View.VISIBLE
            RuneAndroidRouterHost.runtimeOrNull()?.registerSurface(rootView)
            registerSceneSurface(rootView.rootId, this)
        }

        fun render() {
            val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
            runtime.setActiveSurface(rootView.rootId)
            val nameLiteral = JSONObject.quote(routeName)
            val script = """
                (function(){
                  const render = globalThis.__renderRouterScreen;
                  if (typeof render === 'function') {
                    render(${rootView.rootId}, $nameLiteral, $paramsExpression);
                  } else {
                    console.warn('[RuneAndroidRouter] render function missing');
                  }
                })();
            """.trimIndent()
            runtime.evaluateAsync(script)
        }

        fun show() {
            rootView.visibility = View.VISIBLE
        }

        fun hide() {
            rootView.visibility = View.GONE
        }

        fun dispose(host: FrameLayout?) {
            if (disposed) return
            disposed = true
            host?.removeView(rootView)
            val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
            runtime.setActiveSurface(rootView.rootId)
            val script = """
                (function(){
                  const dispose = globalThis.__disposeRouterScreen;
                  if (typeof dispose === 'function') {
                    dispose(${rootView.rootId});
                  }
                })();
            """.trimIndent()
            runtime.evaluateAsync(script)
            runtime.unregisterSurface(rootView.rootId)
            unregisterSceneSurface(rootView.rootId)
        }

        fun markContentRendered() {
            if (disposed) return
            if (!ready) {
                ready = true
                rootView.visibility = View.VISIBLE
            }
            if (!handledReady) {
                handledReady = true
                handleSceneReady(this)
            }
        }
    }

    companion object {
        private const val TAG = "RuneBottomSheetHost"
        private const val DEFAULT_INITIAL_SNAP_INDEX = 0
        private const val DEFAULT_OVERLAY_OPACITY = 0.58f
        private const val DEFAULT_DISMISS_ON_OVERLAY_PRESS = true
        private val DEFAULT_OVERLAY_COLOR = Color.BLACK
    }
}
