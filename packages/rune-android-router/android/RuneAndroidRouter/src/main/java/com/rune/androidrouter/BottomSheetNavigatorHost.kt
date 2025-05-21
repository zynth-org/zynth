package com.rune.androidrouter

import android.graphics.Color
import android.os.Looper
import android.util.Log
import android.view.View
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import com.google.android.material.bottomsheet.BottomSheetBehavior
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
    private var pendingSnapPointReset: PendingSnapPointReset? = null
    private var lastKnownSheetHeight: Int? = null
    private var currentMeasuredSnapIndex: Int? = null
    private var lastCommandedSnapIndex: Int = DEFAULT_INITIAL_SNAP_INDEX

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
        showScene(scene, options, animated)
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
            showScene(previous, options, animated = true)
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

    private fun showScene(scene: BottomSheetScene, options: ResolvedSheetOptions, animated: Boolean) {
        val dialog = ensureDialog()
        val desiredIndex = (scene.lastSnapIndex ?: options.initialSnapIndex).coerceAtLeast(0)
        val indexSelection = configureSnapPoints(
            dialog = dialog,
            snapPoints = options.snapPoints,
            desiredIndex = desiredIndex,
            animateTransition = animated && dialog.isShowing,
        )
        applyNonSnapOptions(dialog, options)
        if (!dialog.isShowing) {
            dialog.present(indexSelection.commandIndex, animated)
        } else {
            dialog.snapTo(indexSelection.commandIndex)
        }
        lastCommandedSnapIndex = indexSelection.commandIndex
        scene.lastSnapIndex = indexSelection.finalIndex
    }

    private fun configureSnapPoints(
        dialog: RuneBottomSheetDialog,
        snapPoints: List<BottomSheetSnapPoint>,
        desiredIndex: Int,
        animateTransition: Boolean,
    ): IndexSelection {
        pendingSnapPointReset = null
        val normalizedDesired = desiredIndex.coerceAtLeast(0)
        if (animateTransition) {
            val transition = maybeBuildSinglePointTransition(dialog, snapPoints, normalizedDesired)
            if (transition != null) {
                dialog.setSnapPoints(transition.temporaryPoints)
                pendingSnapPointReset = PendingSnapPointReset(
                    triggerIndex = transition.commandIndex,
                    finalSnapPoints = snapPoints,
                    finalIndex = transition.finalIndex,
                )
                return IndexSelection(
                    commandIndex = transition.commandIndex,
                    finalIndex = transition.finalIndex,
                )
            }
        }
        dialog.setSnapPoints(snapPoints)
        val resolvedCount = dialog.getResolvedSnapHeights().size.coerceAtLeast(1)
        val clampedIndex = normalizedDesired.coerceIn(0, resolvedCount - 1)
        return IndexSelection(clampedIndex, clampedIndex)
    }

    private fun maybeBuildSinglePointTransition(
        dialog: RuneBottomSheetDialog,
        snapPoints: List<BottomSheetSnapPoint>,
        desiredIndex: Int,
    ): TransitionSnapConfig? {
        if (snapPoints.size != 1) return null
        if (desiredIndex != 0) return null
        val targetPoint = snapPoints.first()
        val screenHeight = dialog.getMaxScreenHeight().takeIf { it > 0 } ?: return null
        val metrics = activity.resources.displayMetrics
        val targetHeight = targetPoint.resolveHeight(screenHeight, metrics)
        val currentHeight = lastKnownSheetHeight ?: resolveCurrentSheetHeight(dialog) ?: return null
        if (currentHeight == targetHeight) return null
        val currentRatio = (currentHeight.toFloat() / screenHeight.toFloat()).coerceIn(0f, 1f)
        val currentPoint = BottomSheetSnapPoint.Percent(currentRatio)
        val entries = listOf(
            SnapPointHeight(targetPoint, targetHeight),
            SnapPointHeight(currentPoint, currentHeight),
        ).distinctBy { it.height }
        if (entries.size < 2) return null
        val sorted = entries.sortedBy { it.height }
        val commandIndex = sorted.indexOfFirst { it.point === targetPoint }
        if (commandIndex == -1) return null
        return TransitionSnapConfig(
            temporaryPoints = sorted.map { it.point },
            commandIndex = commandIndex,
            finalIndex = 0,
        )
    }

    private fun resolveCurrentSheetHeight(dialog: RuneBottomSheetDialog): Int? {
        val resolved = dialog.getResolvedSnapHeights()
        if (resolved.isEmpty()) return null
        val index = (currentMeasuredSnapIndex ?: lastCommandedSnapIndex).coerceIn(0, resolved.size - 1)
        return resolved[index]
    }

    private fun applyNonSnapOptions(dialog: RuneBottomSheetDialog, options: ResolvedSheetOptions) {
        dialog.setOverlayColor(options.overlayColor)
        dialog.setOverlayOpacity(options.overlayOpacity)
        dialog.setDismissOnOverlayPress(options.dismissOnOverlayPress)
    }

    private fun handleBottomSheetStateChanged(newState: Int) {
        if (newState == BottomSheetBehavior.STATE_DRAGGING || newState == BottomSheetBehavior.STATE_SETTLING) {
            return
        }
        if (newState == BottomSheetBehavior.STATE_HIDDEN) {
            currentMeasuredSnapIndex = null
            return
        }
        val dialog = dialog ?: return
        val resolvedCount = dialog.getResolvedSnapHeights().size
        if (resolvedCount == 0) return
        val mappedIndex = mapStateToIndex(newState, resolvedCount) ?: return
        currentMeasuredSnapIndex = mappedIndex
        routeStack.lastOrNull()?.lastSnapIndex = mappedIndex
        lastCommandedSnapIndex = mappedIndex
        checkPendingSnapPointReset(mappedIndex)
    }

    private fun checkPendingSnapPointReset(currentIndex: Int) {
        val pending = pendingSnapPointReset ?: return
        if (currentIndex != pending.triggerIndex) {
            return
        }
        pendingSnapPointReset = null
        val dialog = dialog ?: return
        dialog.setSnapPoints(pending.finalSnapPoints)
        val finalCount = dialog.getResolvedSnapHeights().size.coerceAtLeast(1)
        val normalizedFinal = pending.finalIndex.coerceIn(0, finalCount - 1)
        lastCommandedSnapIndex = normalizedFinal
        currentMeasuredSnapIndex = normalizedFinal
        routeStack.lastOrNull()?.lastSnapIndex = normalizedFinal
    }

    private fun mapStateToIndex(state: Int, snapCount: Int): Int? {
        return when (snapCount) {
            1 -> if (state == BottomSheetBehavior.STATE_EXPANDED) 0 else null
            2 -> when (state) {
                BottomSheetBehavior.STATE_COLLAPSED -> 0
                BottomSheetBehavior.STATE_EXPANDED -> 1
                else -> null
            }
            else -> when (state) {
                BottomSheetBehavior.STATE_COLLAPSED -> 0
                BottomSheetBehavior.STATE_HALF_EXPANDED -> 1
                BottomSheetBehavior.STATE_EXPANDED -> 2
                else -> null
            }
        }
    }

    private fun resetSheetTracking() {
        pendingSnapPointReset = null
        lastKnownSheetHeight = null
        currentMeasuredSnapIndex = null
        lastCommandedSnapIndex = DEFAULT_INITIAL_SNAP_INDEX
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
                        resetSheetTracking()
                        if (suppressDismissCallback) {
                            suppressDismissCallback = false
                            return
                        }
                        clearStack()
                    }

                    override fun onSlide(sheet: View, slideOffset: Float) {
                        lastKnownSheetHeight = sheetDialog.visibleHeightForSheet(sheet)
                    }

                    override fun onStateChanged(sheet: View, newState: Int) {
                        handleBottomSheetStateChanged(newState)
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
        resetSheetTracking()
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

    private data class IndexSelection(
        val commandIndex: Int,
        val finalIndex: Int,
    )

    private data class PendingSnapPointReset(
        val triggerIndex: Int,
        val finalSnapPoints: List<BottomSheetSnapPoint>,
        val finalIndex: Int,
    )

    private data class TransitionSnapConfig(
        val temporaryPoints: List<BottomSheetSnapPoint>,
        val commandIndex: Int,
        val finalIndex: Int,
    )

    private data class SnapPointHeight(
        val point: BottomSheetSnapPoint,
        val height: Int,
    )

    private inner class BottomSheetScene(
        val routeName: String,
        params: JSONObject?,
        deferVisibility: Boolean,
    ) {
        val rootView: RuneRootView = RuneRootView(activity)
        private val paramsExpression: String = params?.toString() ?: "null"
        var lastSnapIndex: Int? = null
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
