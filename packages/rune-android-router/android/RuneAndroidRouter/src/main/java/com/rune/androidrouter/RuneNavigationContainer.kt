package com.rune.androidrouter

import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewPropertyAnimator
import android.view.ViewTreeObserver
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.appcompat.widget.Toolbar
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentManager
import com.rune.androidrouter.R
import com.rune.kit.core.RuneRootView
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

enum class SurfaceReadySource {
    NATIVE_FIRST_FRAME,
    JS_BRIDGE,
    TIMEOUT_FALLBACK,
}

/**
 * Minimal Android Router - Single screen container for iterating on basic navigation.
 * * This is a deliberately simple implementation to avoid the complexity that causes
 * freezes and rendering issues. Once stable, it will be merged into the main router.
 */
class RuneNavigationContainer {
    private val TAG = "RuneAndroidRouter"
    private var pendingHeaderOptions: JSONObject? = null
    private val headerOptionsMap = ConcurrentHashMap<String, JSONObject>()
    private val mainThreadHandler = Handler(Looper.getMainLooper())
    
    companion object {
        private var currentFragmentManager: FragmentManager? = null
        private var mainRuntime: com.rune.kit.runtime.RuneRuntime? = null
        private val fragmentRegistry = ConcurrentHashMap<Int, WeakReference<RuneScreenFragment>>()
        private val fragmentByRouteKey = ConcurrentHashMap<String, WeakReference<RuneScreenFragment>>()
        private var defaultSurfaceId: Int = 0
        private val mainThreadHandler = Handler(Looper.getMainLooper())
        
        @JvmStatic
        fun setFragmentManager(manager: FragmentManager) {
            currentFragmentManager = manager
            Log.d("RuneAndroidRouter", "FragmentManager set: $manager")
        }
        
        @JvmStatic
        fun getCurrentFragmentManager(): FragmentManager? {
            return currentFragmentManager
        }
        
        @JvmStatic
        fun setMainRuntime(runtime: com.rune.kit.runtime.RuneRuntime) {
            mainRuntime = runtime
            Log.e("RuneAndroidRouter", "🔥 Main runtime set: $runtime")
            defaultSurfaceId = runtime.getRootSurfaceId()
        }
        
        @JvmStatic
        fun getMainRuntime(): com.rune.kit.runtime.RuneRuntime? {
            return mainRuntime
        }

        fun registerFragmentSurface(rootId: Int, fragment: RuneScreenFragment) {
            fragmentRegistry[rootId] = WeakReference(fragment)
            fragment.screenName?.let { screenName ->
                fragmentByRouteKey[screenName] = WeakReference(fragment)
            }
        }

        fun unregisterFragmentSurface(rootId: Int) {
            fragmentRegistry.remove(rootId)
        }
        
        fun getFragmentByRouteKey(routeKey: String): RuneScreenFragment? {
            return fragmentByRouteKey[routeKey]?.get()
        }

        fun notifySurfaceReady(rootId: Int, source: SurfaceReadySource) {
            fragmentRegistry[rootId]?.get()?.let { fragment ->
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    fragment.onSurfaceReady(source)
                } else {
                    mainThreadHandler.post { fragment.onSurfaceReady(source) }
                }
            }
        }

        fun notifySurfaceDisposed(rootId: Int) {
            fragmentRegistry[rootId]?.get()?.let { fragment ->
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    fragment.onSurfaceDisposed(rootId)
                } else {
                    mainThreadHandler.post { fragment.onSurfaceDisposed(rootId) }
                }
            }
        }

        fun getDefaultSurfaceId(): Int = defaultSurfaceId.takeIf { it != 0 } ?: mainRuntime?.getRootSurfaceId() ?: 0
    }
    
    /**
     * Initialize the router with a root view container
     */
    fun initialize(containerId: Int, fragmentManager: FragmentManager) {
        Log.d(TAG, "Initializing navigation container with ID: $containerId")
        currentFragmentManager = fragmentManager
    }
    
    /**
     * Set the initial screen as a fragment (for Home screen with header support)
     */
    fun setInitialScreen(screenName: String, headerOptions: JSONObject? = null) {
        val manager = currentFragmentManager ?: run {
            Log.e(TAG, "FragmentManager not available")
            return
        }
        
        // Only set initial screen if no fragments exist yet
        if (manager.backStackEntryCount > 0) {
            Log.d(TAG, "Initial screen already set, ignoring")
            return
        }
        
        val fragment = RuneScreenFragment.newInstance(screenName, null, headerOptions, isInitial = true)
        
        // Don't use animations for the initial screen
        val transaction = manager.beginTransaction()
            .setCustomAnimations(0, 0, 0, 0) // No animations
            .add(android.R.id.content, fragment, screenName)
        
        // Don't add to back stack for the initial screen
        transaction.commit()
        Log.d(TAG, "Initial screen set: $screenName with header options: $headerOptions")
    }
    
    /**
     * Store header options for the next screen to be pushed
     */
    fun setPendingHeaderOptions(options: JSONObject) {
        pendingHeaderOptions = options
        Log.d(TAG, "Stored pending header options: $options")
    }
    
    /**
     * Store header options for a specific route and update if fragment exists
     */
    fun setHeaderOptionsForRoute(routeKey: String, options: JSONObject) {
        headerOptionsMap[routeKey] = options
        Log.d(TAG, "Stored header options for route $routeKey: $options")
        
        // Try to update the fragment if it's already created
        val fragment = RuneNavigationContainer.getFragmentByRouteKey(routeKey)
        if (fragment != null) {
            mainThreadHandler.post {
                fragment.updateHeaderOptions(options)
                Log.d(TAG, "Updated existing fragment header for route $routeKey")
            }
        }
    }
    
    /**
     * Get header options for a screen, consuming pending options if available
     */
    fun getHeaderOptionsForScreen(screenName: String): JSONObject? {
        val options = pendingHeaderOptions ?: headerOptionsMap[screenName]
        pendingHeaderOptions = null // Clear pending after use
        return options
    }
    
    /**
     * Push a new screen onto the stack
     */
    fun pushScreen(screenName: String, params: JSONObject? = null) {
        val manager = currentFragmentManager ?: run {
            Log.e(TAG, "FragmentManager not available")
            return
        }
        
        val headerOptions = getHeaderOptionsForScreen(screenName)
        val fragment = RuneScreenFragment.newInstance(screenName, params, headerOptions)
        
        val transaction = manager.beginTransaction()
            .setCustomAnimations(
                0,
                0,
                R.anim.rune_slide_in_left,
                R.anim.rune_slide_out_right
            )
            .add(android.R.id.content, fragment, screenName)
            .addToBackStack(screenName)
        
        transaction.commit()
    }
    
    /**
     * Pop the current screen from the stack
     */
    fun popScreen() {
        val manager = currentFragmentManager ?: run {
            Log.e(TAG, "FragmentManager not available")
            return
        }
        
        Log.d(TAG, "Popping screen")

        if (manager.backStackEntryCount > 0) {
            manager.popBackStack()
        }
    }
}

/**
 * Fragment that hosts a Rune screen
 */
class RuneScreenFragment : Fragment() {
    private var _screenName: String? = null
    private var params: JSONObject? = null
    private var headerOptions: JSONObject? = null
    private var runeRootView: RuneRootView? = null
    private var toolbar: Toolbar? = null
    private var isInitialScreen = false
    private var enterTransitionStarted = false
    private var surfaceReadyListener: (() -> Unit)? = null
    private var lastSurfaceRootId: Int? = null
    private var disposalCompleted = false
    private var disposalTimeout: Runnable? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var layoutReadyListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var surfaceReadyDelivered = false
    private var nativeFirstFrameReceived = false
    private var surfaceReadyTimeoutRunnable: Runnable? = null
    private var surfaceReadySource: SurfaceReadySource? = null
    private var startTime: Long = 0 // <--- ADDED: Time measurement variable
    private var hasRunEnterAnimation = false
    private var enterAnimator: ViewPropertyAnimator? = null
    
    // Public getter for screenName
    val screenName: String?
        get() = _screenName
    
    companion object {
        private const val ARG_SCREEN_NAME = "screen_name"
        private const val ARG_PARAMS = "params"
        private const val ARG_HEADER_OPTIONS = "header_options"
        private const val ARG_IS_INITIAL = "is_initial"
        private const val SURFACE_READY_TIMEOUT_MS = 800L
        
        fun newInstance(screenName: String, params: JSONObject?, headerOptions: JSONObject? = null, isInitial: Boolean = false): RuneScreenFragment {
            return RuneScreenFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_SCREEN_NAME, screenName)
                    params?.let { putString(ARG_PARAMS, it.toString()) }
                    headerOptions?.let { putString(ARG_HEADER_OPTIONS, it.toString()) }
                    putBoolean(ARG_IS_INITIAL, isInitial)
                }
            }
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startTime = System.currentTimeMillis() // <--- ADDED: Start time
        isInitialScreen = arguments?.getBoolean(ARG_IS_INITIAL, false) ?: false
        
        if (!isInitialScreen) {
            Log.d("RuneScreenFragment", "🔥 [T=0ms] onCreate: POSTPONING transition for $screenName")
            postponeEnterTransition()
        } else {
            Log.d("RuneScreenFragment", "🔥 [T=0ms] onCreate: Initial screen, NOT postponing transition for $screenName")
        }
        
        _screenName = arguments?.getString(ARG_SCREEN_NAME)
        arguments?.getString(ARG_PARAMS)?.let {
            params = JSONObject(it)
        }
        arguments?.getString(ARG_HEADER_OPTIONS)?.let {
            headerOptions = JSONObject(it)
            Log.d("RuneScreenFragment", "Header options loaded: $headerOptions")
        }
    }
    
    override fun onCreateView(
        inflater: android.view.LayoutInflater,
        container: android.view.ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        
        // Allocate a unique rootId for this Fragment surface
        val surfaceRootId = RuneRootView.allocateRootId()
        
        // Create a RuneRootView to host the actual screen content
        runeRootView = RuneRootView(requireContext(), explicitRootId = surfaceRootId).apply {
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
            // Initial screen should be fully visible from the start
            // Non-initial screens start offscreen and animate in
            alpha = if (isInitialScreen) 1f else 0f
            translationX = 0f
            isClickable = true
            isFocusable = true
            setBackgroundColor(Color.TRANSPARENT)
        }
        enterTransitionStarted = false
        disposalCompleted = false
        lastSurfaceRootId = surfaceRootId
        disposalTimeout = null
        surfaceReadyDelivered = false
        nativeFirstFrameReceived = false
        surfaceReadyTimeoutRunnable = null
        surfaceReadySource = null
        enterAnimator = null
        
        if (isInitialScreen) {
            // For initial screen, mark animation as already done so it never runs
            hasRunEnterAnimation = true
        }
        layoutReadyListener = ViewTreeObserver.OnGlobalLayoutListener {
            if (hasMeasuredSize()) {
                tryStartSurfaceAnimation()
            }
        }
        runeRootView?.viewTreeObserver?.addOnGlobalLayoutListener(layoutReadyListener)

        RuneNavigationContainer.registerFragmentSurface(surfaceRootId, this)

        // Check if header should be shown (default true)
        val headerShown = headerOptions?.optBoolean("headerShown", true) ?: true
        
        return if (headerShown) {
            // Create container with Toolbar + content
            createViewWithToolbar(runeRootView!!)
        } else {
            // Return just the content view
            runeRootView
        }
    }
    
    private fun createViewWithToolbar(contentView: View): View {
        val context = requireContext()
        
        // Create container
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        
        // Create toolbar
        toolbar = Toolbar(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                context.resources.getDimensionPixelSize(R.dimen.rune_toolbar_height)
            )
            // Set default background to avoid theme color bleeding through
            setBackgroundColor(Color.parseColor("#FFFFFF"))
        }
        
        // Apply header options to toolbar
        applyHeaderOptions(toolbar!!)
        
        // Wrap RuneRootView in a FrameLayout to avoid LayoutParams cast issues
        val contentContainer = FrameLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f // weight = 1 to fill remaining space
            )
        }
        
        // Add content view to the frame container with FrameLayout.LayoutParams
        contentView.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        )
        contentContainer.addView(contentView)
        
        // Add toolbar and content container to the vertical LinearLayout
        container.addView(toolbar)
        container.addView(contentContainer)
        
        return container
    }
    
    private fun applyHeaderOptions(toolbar: Toolbar) {
        val context = requireContext()
        
        // Set default title color (black) to ensure it's visible on white background
        toolbar.setTitleTextColor(Color.parseColor("#000000"))
        
        val options = headerOptions
        if (options == null) {
            // No options, just set the screen name as title
            toolbar.title = screenName
            return
        }
        
        // Set title
        val title = options.optString("title", screenName)
        toolbar.title = title
        
        // Set subtitle if provided
        if (options.has("subtitle")) {
            toolbar.subtitle = options.optString("subtitle")
        }
        
        // Set background color
        if (options.has("headerBackgroundColor")) {
            try {
                val bgColor = Color.parseColor(options.getString("headerBackgroundColor"))
                toolbar.setBackgroundColor(bgColor)
            } catch (e: Exception) {
                Log.w("RuneScreenFragment", "Invalid headerBackgroundColor: ${e.message}")
            }
        }
        
        // Set tint color (for title and icons)
        if (options.has("headerTintColor")) {
            try {
                val tintColor = Color.parseColor(options.getString("headerTintColor"))
                toolbar.setTitleTextColor(tintColor)
                toolbar.setSubtitleTextColor(tintColor)
                // Set navigation icon tint if we have a back button
                toolbar.navigationIcon?.setTint(tintColor)
            } catch (e: Exception) {
                Log.w("RuneScreenFragment", "Invalid headerTintColor: ${e.message}")
            }
        }
        
        // Set transparent background if requested
        if (options.optBoolean("headerTransparent", false)) {
            toolbar.setBackgroundColor(Color.TRANSPARENT)
        }
        
        // Handle elevation (shadow)
        val shadowVisible = options.optBoolean("headerShadowVisible", true)
        if (shadowVisible) {
            ViewCompat.setElevation(toolbar, 4f * context.resources.displayMetrics.density) // 4dp
        } else {
            ViewCompat.setElevation(toolbar, 0f)
        }
        
        // Add back button if not the first screen
        val fragmentManager = RuneNavigationContainer.getCurrentFragmentManager()
        if (fragmentManager != null && fragmentManager.backStackEntryCount > 0) {
            val backIcon = ContextCompat.getDrawable(context, R.drawable.rune_ic_arrow_back)
            toolbar.navigationIcon = backIcon
            
            // Apply tint to navigation icon if we have one
            if (options.has("headerTintColor")) {
                try {
                    val tintColor = Color.parseColor(options.getString("headerTintColor"))
                    toolbar.navigationIcon?.setTint(tintColor)
                } catch (e: Exception) {
                    // Already logged above
                }
            }
            
            toolbar.setNavigationOnClickListener {
                fragmentManager.popBackStack()
            }
        }
        
        Log.d("RuneScreenFragment", "Applied header options to toolbar: title=$title")
    }
    
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        Log.d("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] onViewCreated") // <--- ADDED LOG

        runeRootView?.let { rootView ->
            
            // Get the main runtime
            val runtime = RuneNavigationContainer.getMainRuntime()
            if (runtime == null) {
                Log.e("RuneScreenFragment", "🔥 ERROR: Main runtime not available!")
                return
            }
            
            runtime.registerSurface(rootView)
            runtime.setActiveSurface(rootView.rootId)

            val surfaceId = rootView.rootId
            val readyListener = {
                RuneNavigationContainer.notifySurfaceReady(surfaceId, SurfaceReadySource.NATIVE_FIRST_FRAME)
            }
            surfaceReadyListener = readyListener
            runtime.addSurfaceFirstFrameListener(surfaceId, readyListener)
            
            // Fallback: ensure transitions start even if JS never calls back
            val fallbackRunnable = Runnable {
                Log.w("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] ${SURFACE_READY_TIMEOUT_MS}ms FALLBACK triggered for surfaceId=${rootView.rootId}")
                RuneNavigationContainer.notifySurfaceReady(rootView.rootId, SurfaceReadySource.TIMEOUT_FALLBACK)
            }
            surfaceReadyTimeoutRunnable = fallbackRunnable
            rootView.postDelayed(fallbackRunnable, SURFACE_READY_TIMEOUT_MS)
            
            val paramsJson = params?.toString() ?: "null"
            val jsCode = """
                (function() {
                    if (typeof globalThis.__renderRouterScreen === 'function') {
                        console.log('[RuneScreenFragment] 🔥 Calling __renderRouterScreen');
                        globalThis.__renderRouterScreen(${rootView.rootId}, '$screenName', $paramsJson);
                    } else {
                        console.error('[RuneScreenFragment] ❌ __renderRouterScreen not available!');
                    }
                })();
            """.trimIndent()
            
            Log.e("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] Evaluating JS to render screen into rootId=${rootView.rootId}") // <--- UPDATED LOG
            
            if (isInitialScreen) {
                // For initial screen, wait for layout to complete before rendering JS content
                rootView.post {
                    rootView.post {
                        Log.e("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] Initial screen layout complete, now rendering JS")
                        runtime.evaluateAsync(jsCode)
                    }
                }
            } else {
                runtime.evaluateAsync(jsCode)
            }
        }

        // <<<--- LINE REMOVED (startEnterTransitionIfNeeded()) ---<<<
    }
    
    override fun onDestroyView() {
        super.onDestroyView()
        
        val runtime = RuneNavigationContainer.getMainRuntime()
        val rootId = runeRootView?.rootId ?: lastSurfaceRootId
        val listener = surfaceReadyListener
        if (runtime != null && rootId != null && listener != null) {
            runtime.removeSurfaceFirstFrameListener(rootId, listener)
        }
        surfaceReadyListener = null
        removeLayoutReadyListener()
        cancelSurfaceReadyTimeout()
        enterAnimator?.cancel()
        enterAnimator = null
        if (runtime != null && rootId != null) {
            val jsCode = """
                (function() {
                    if (typeof globalThis.__disposeRouterScreen === 'function') {
                        console.log('[RuneScreenFragment] 🔥 Calling __disposeRouterScreen');
                        globalThis.__disposeRouterScreen($rootId);
                        if (globalThis.__modules && typeof globalThis.__modules.call === 'function') {
                            globalThis.__modules.call("RuneAndroidRouter", "surfaceDisposed", [$rootId]);
                        }
                    }
                })();
            """.trimIndent()
            runtime.evaluateAsync(jsCode)
            scheduleDisposalFallback(rootId)
        } else if (rootId != null) {
            completeSurfaceDisposal(rootId)
        }

        runeRootView = null
    }
    
    fun getRootView(): RuneRootView? = runeRootView
    
    /**
     * Update header options dynamically after the fragment is created
     */
    fun updateHeaderOptions(newOptions: JSONObject) {
        headerOptions = newOptions
        toolbar?.let { applyHeaderOptions(it) }
    }

    private fun startEnterTransitionIfNeeded() {
        if (enterTransitionStarted) return
        if (isInitialScreen) {
            // Initial screen doesn't need postponed transition
            Log.d("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] Initial screen, skipping postponed transition")
            return
        }
        enterTransitionStarted = true
        // <--- CRITICAL LOG: This tells you when the animation is told to start --->
        Log.e("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] startEnterTransitionIfNeeded: STARTING POSTPONED TRANSITION")

        view?.post {
            try {
                startPostponedEnterTransition()
            } catch (t: Throwable) {
                Log.w("RuneScreenFragment", "Failed to start postponed transition", t)
            }
        }
    }

    fun onSurfaceReady(source: SurfaceReadySource) {
        when (source) {
            SurfaceReadySource.NATIVE_FIRST_FRAME -> {
                nativeFirstFrameReceived = true
                deliverSurfaceReady(source)
            }
            SurfaceReadySource.TIMEOUT_FALLBACK -> {
                deliverSurfaceReady(source)
            }
            SurfaceReadySource.JS_BRIDGE -> {
                if (nativeFirstFrameReceived) {
                    Log.d("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] Ignoring JS surfaceReady; native frame already delivered")
                } else {
                    Log.w("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] JS surfaceReady arrived before native first frame; holding animation")
                }
            }
        }
    }

    fun onSurfaceDisposed(surfaceId: Int) {
        if (surfaceId != lastSurfaceRootId) { 
            completeSurfaceDisposal(surfaceId)
            return
        }
        view?.post {
            completeSurfaceDisposal(surfaceId)
        } ?: completeSurfaceDisposal(surfaceId)
    }

    private fun scheduleDisposalFallback(rootId: Int) {
        val timeoutRunnable = Runnable {
            Log.w("RuneScreenFragment", "Disposal timeout for surfaceId=$rootId, forcing cleanup")
            completeSurfaceDisposal(rootId)
        }
        disposalTimeout = timeoutRunnable
        mainHandler.postDelayed(timeoutRunnable, 800)
    }

    private fun completeSurfaceDisposal(rootId: Int) {
        if (disposalCompleted) return
        disposalCompleted = true
        disposalTimeout?.let { runnable ->
            mainHandler.removeCallbacks(runnable)
            disposalTimeout = null
        }
        val runtime = RuneNavigationContainer.getMainRuntime()
        runtime?.unregisterSurface(rootId)
        val defaultSurfaceId = RuneNavigationContainer.getDefaultSurfaceId()
        if (runtime != null && defaultSurfaceId != 0) {
            runtime.setActiveSurface(defaultSurfaceId)
        }
        RuneNavigationContainer.unregisterFragmentSurface(rootId)
        if (lastSurfaceRootId == rootId) {
            lastSurfaceRootId = null
        }
    }

    private fun removeLayoutReadyListener() {
        val listener = layoutReadyListener ?: return
        runeRootView?.viewTreeObserver?.removeOnGlobalLayoutListener(listener)
        layoutReadyListener = null
    }

    private fun cancelSurfaceReadyTimeout() {
        val runnable = surfaceReadyTimeoutRunnable ?: return
        runeRootView?.removeCallbacks(runnable)
        surfaceReadyTimeoutRunnable = null
    }

    private fun deliverSurfaceReady(source: SurfaceReadySource) {
        if (surfaceReadyDelivered) return
        surfaceReadyDelivered = true
        surfaceReadySource = source
        cancelSurfaceReadyTimeout()
        Log.d(
            "RuneScreenFragment",
            "🔥 [T=${System.currentTimeMillis() - startTime}ms] onSurfaceReady: Signal RECEIVED via $source"
        )
        tryStartSurfaceAnimation()
    }

    private fun hasMeasuredSize(): Boolean {
        val view = runeRootView
        return view != null && view.width > 0 && view.height > 0
    }

    private fun tryStartSurfaceAnimation() {
        val view = runeRootView
        val ready = surfaceReadyDelivered
        val measured = hasMeasuredSize()
        val laidOut = view?.let { ViewCompat.isLaidOut(it) } ?: false
        val source = surfaceReadySource ?: SurfaceReadySource.NATIVE_FIRST_FRAME
        Log.d(
            "RuneScreenFragment",
            "🔥 [T=${System.currentTimeMillis() - startTime}ms] tryStartSurfaceAnimation: Checking... (Ready=$ready, Measured=$measured, LaidOut=$laidOut, Animated=$hasRunEnterAnimation, Source=$source, IsInitial=$isInitialScreen)"
        )

        if (!ready || !measured || !laidOut || hasRunEnterAnimation || view == null) {
            return
        }
        
        // Skip animation for initial screen - just show it immediately
        if (isInitialScreen) {
            Log.d(
                "RuneScreenFragment",
                "🔥 [T=${System.currentTimeMillis() - startTime}ms] Initial screen - skipping animation, showing immediately"
            )
            hasRunEnterAnimation = true
            view.translationX = 0f
            view.alpha = 1f
            startEnterTransitionIfNeeded()
            removeLayoutReadyListener()
            return
        }

        val runtime = RuneNavigationContainer.getMainRuntime()
        val surfaceId = view.rootId
        val surfaceIdle = runtime?.isSurfaceIdle(surfaceId) ?: true
        if (!surfaceIdle) {
            Log.d(
                "RuneScreenFragment",
                "🔥 [T=${System.currentTimeMillis() - startTime}ms] tryStartSurfaceAnimation: Surface $surfaceId still flushing, deferring animation"
            )
            view.postOnAnimation { tryStartSurfaceAnimation() }
            return
        }

        hasRunEnterAnimation = true
        val slideDuration = 220L
        val fadeDuration = 160L

        enterAnimator?.cancel()
        val animation = view.animate()
        if (source == SurfaceReadySource.TIMEOUT_FALLBACK) {
            view.translationX = 0f
            view.alpha = 0f
            animation
                .alpha(1f)
                .setDuration(fadeDuration)
                .setInterpolator(AccelerateDecelerateInterpolator())
                .withStartAction { startEnterTransitionIfNeeded() }
                .start()
        } else {
            val width = view.width.toFloat().takeIf { it > 0 }
                ?: view.resources.displayMetrics.widthPixels.toFloat()
            view.translationX = width
            view.alpha = 0f
            animation
                .translationX(0f)
                .alpha(1f)
                .setDuration(slideDuration)
                .setInterpolator(AccelerateDecelerateInterpolator())
                .withStartAction { startEnterTransitionIfNeeded() }
                .start()
        }
        enterAnimator = animation
        animation.withEndAction {
            enterAnimator = null
        }
        removeLayoutReadyListener()
    }
}
