package com.rune.androidrouter

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Looper
import android.util.Log
import android.view.View
import android.widget.FrameLayout
import android.view.animation.LinearInterpolator
import android.util.TypedValue
import android.view.ViewOutlineProvider
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
    
    private val sceneBySurfaceId = mutableMapOf<Int, BottomSheetScene>()
    private var activeSceneTransition: ValueAnimator? = null
    private var programmaticTargetIndex: Int? = null

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
        if (routeStack.size <= 1) {
            clearStack()
            return false
        }

        val removed = routeStack.removeAt(routeStack.lastIndex)
        val previous = routeStack.last()
        val options = resolveOptionsForRoute(previous.routeName)
        showScene(previous, options, animated = true)
        startPopSceneTransition(previous, removed)
        Log.d(TAG, "popRoute route=${removed.routeName} -> previous=${previous.routeName}")
        return true
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
        
        // SIMPLIFIED: Always use the scene's desired snap index
        val desiredIndex = options.initialSnapIndex.coerceAtLeast(0)
        
        Log.d(TAG, "showScene route=${scene.routeName} desiredIndex=$desiredIndex animated=$animated snapCount=${options.snapPoints.size}")
        
        // SIMPLIFIED: Set snap points and snap immediately - no complex transition logic
        dialog.setSnapPoints(options.snapPoints)
        applyNonSnapOptions(dialog, options)
        
        programmaticTargetIndex = desiredIndex
        
        if (!dialog.isShowing) {
            dialog.present(desiredIndex, animated)
        } else {
            dialog.snapTo(desiredIndex)
        }
        
        Log.d(TAG, "showScene applied route=${scene.routeName} desiredIndex=$desiredIndex")
        
        // Track the active index for this scene
        scene.lastSnapIndex = desiredIndex
    }

    private fun startPushSceneTransition(previous: BottomSheetScene, entering: BottomSheetScene) {
        crossFadeScenes(
            entering = entering,
            exiting = previous,
            afterExit = {
                previous.rootView.alpha = 1f
                previous.rootView.visibility = View.GONE
            },
            afterEnter = {
                entering.rootView.alpha = 1f
                entering.rootView.visibility = View.VISIBLE
            },
        )
    }

    private fun startPopSceneTransition(entering: BottomSheetScene, exiting: BottomSheetScene) {
        crossFadeScenes(
            entering = entering,
            exiting = exiting,
            afterExit = {
                exiting.dispose(contentHost)
            },
            afterEnter = {
                entering.rootView.alpha = 1f
                entering.rootView.visibility = View.VISIBLE
            },
        )
    }

    private fun crossFadeScenes(
        entering: BottomSheetScene,
        exiting: BottomSheetScene?,
        afterExit: (() -> Unit)? = null,
        afterEnter: (() -> Unit)? = null,
    ) {
        cancelSceneTransition()
        val enteringView = entering.rootView
        enteringView.visibility = View.VISIBLE
        enteringView.alpha = 0f
        val slideDistance = sceneSlideDistancePx()
        enteringView.translationX = slideDistance
        val exitingView = exiting?.rootView
        exitingView?.let {
            it.visibility = View.VISIBLE
            it.alpha = 1f
            it.translationX = 0f
        }
        val animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = SCENE_FADE_DURATION_MS
            interpolator = LinearInterpolator()
            addUpdateListener { valueAnimator ->
                val progress = valueAnimator.animatedValue as Float
                enteringView.alpha = progress
                enteringView.translationX = slideDistance * (1f - progress)
                exitingView?.alpha = 1f - progress
                exitingView?.translationX = -slideDistance * progress
            }
            addListener(object : AnimatorListenerAdapter() {
                private var completed = false
                private fun finish() {
                    if (completed) return
                    completed = true
                    activeSceneTransition = null
                    enteringView.alpha = 1f
                    enteringView.translationX = 0f
                    afterEnter?.invoke()
                    exitingView?.alpha = 1f
                    exitingView?.translationX = 0f
                    afterExit?.invoke()
                }

                override fun onAnimationEnd(animation: Animator) = finish()
                override fun onAnimationCancel(animation: Animator) = finish()
            })
        }
        activeSceneTransition = animator
        animator.start()
    }

    private fun cancelSceneTransition() {
        activeSceneTransition?.cancel()
        activeSceneTransition = null
    }

    private fun sceneSlideDistancePx(): Float {
        return dpToPx(SCENE_SLIDE_DISTANCE_DP)
    }

    private fun dpToPx(value: Float): Float {
        val metrics = activity.resources.displayMetrics
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, metrics)
    }

    private fun applyNonSnapOptions(dialog: RuneBottomSheetDialog, options: ResolvedSheetOptions) {
        dialog.setOverlayColor(options.overlayColor)
        dialog.setOverlayOpacity(options.overlayOpacity)
        dialog.setDismissOnOverlayPress(options.dismissOnOverlayPress)
    }

    private fun handleBottomSheetStateChanged(newState: Int) {
        // SIMPLIFIED: Only track meaningful states, ignore intermediate states
        if (newState == BottomSheetBehavior.STATE_DRAGGING || newState == BottomSheetBehavior.STATE_SETTLING) {
            return
        }
        
        if (newState == BottomSheetBehavior.STATE_HIDDEN) {
            return
        }
        
        // Clear programmatic target once we reach a stable state
        if (newState == BottomSheetBehavior.STATE_COLLAPSED || 
            newState == BottomSheetBehavior.STATE_EXPANDED || 
            newState == BottomSheetBehavior.STATE_HALF_EXPANDED) {
            programmaticTargetIndex = null
        }
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
                        clearStack()
                    }

                    override fun onSlide(sheet: View, slideOffset: Float) {
                        // SIMPLIFIED: No complex tracking during slides
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
                clipChildren = true
                clipToPadding = true
                outlineProvider = ViewOutlineProvider.BACKGROUND
                clipToOutline = true
                background = GradientDrawable().apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = dpToPx(SCENE_CONTAINER_CORNER_RADIUS_DP)
                    setColor(SCENE_CONTAINER_BACKGROUND_COLOR)
                }
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
        if (index == -1) {
            return
        }
        if (index == 0) {
            scene.rootView.visibility = View.VISIBLE
            scene.rootView.alpha = 1f
            return
        }
        val previous = routeStack[index - 1]
        startPushSceneTransition(previous, scene)
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
        var lastSnapIndex: Int? = null
        private var disposed = false
        private var ready = false
        private var handledReady = false

        init {
            rootView.layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
            if (deferVisibility) {
                rootView.visibility = View.INVISIBLE
                rootView.alpha = 0f
            } else {
                rootView.visibility = View.VISIBLE
                rootView.alpha = 1f
            }
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
        private const val SCENE_FADE_DURATION_MS = 220L
        private const val SCENE_SLIDE_DISTANCE_DP = 24f
        private const val SCENE_CONTAINER_CORNER_RADIUS_DP = 16f
        private val SCENE_CONTAINER_BACKGROUND_COLOR = Color.WHITE
    }
}