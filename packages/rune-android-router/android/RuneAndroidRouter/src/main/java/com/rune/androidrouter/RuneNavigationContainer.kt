package com.rune.androidrouter

import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewTreeObserver
import android.view.animation.AccelerateDecelerateInterpolator
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
    
    companion object {
        private var currentFragmentManager: FragmentManager? = null
        private var mainRuntime: com.rune.kit.runtime.RuneRuntime? = null
        private val fragmentRegistry = ConcurrentHashMap<Int, WeakReference<RuneScreenFragment>>()
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
        }

        fun unregisterFragmentSurface(rootId: Int) {
            fragmentRegistry.remove(rootId)
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
     * Push a new screen onto the stack
     */
    fun pushScreen(screenName: String, params: JSONObject? = null) {
        val manager = currentFragmentManager ?: run {
            Log.e(TAG, "FragmentManager not available")
            return
        }
        
        val fragment = RuneScreenFragment.newInstance(screenName, params)
        
        // Add fragment with slide animations
        // Push: new screen slides in from right, old slides out to left
        // Pop: current slides out to right, previous slides in from left
        val transaction = manager.beginTransaction()
            .setCustomAnimations(
                R.anim.rune_slide_in_right,
                R.anim.rune_fade_out,
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
    private var screenName: String? = null
    private var params: JSONObject? = null
    private var runeRootView: RuneRootView? = null
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
    private var startTime: Long = 0 // <--- ADDED: Time measurement variable
    private var hasRunEnterAnimation = false
    
    companion object {
        private const val ARG_SCREEN_NAME = "screen_name"
        private const val ARG_PARAMS = "params"
        private const val SURFACE_READY_TIMEOUT_MS = 5000L
        
        fun newInstance(screenName: String, params: JSONObject?): RuneScreenFragment {
            return RuneScreenFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_SCREEN_NAME, screenName)
                    params?.let { putString(ARG_PARAMS, it.toString()) }
                }
            }
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startTime = System.currentTimeMillis() // <--- ADDED: Start time
        Log.d("RuneScreenFragment", "🔥 [T=0ms] onCreate: POSTPONING transition for $screenName") // <--- ADDED LOG
        postponeEnterTransition()
        screenName = arguments?.getString(ARG_SCREEN_NAME)
        arguments?.getString(ARG_PARAMS)?.let {
            params = JSONObject(it)
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
            alpha = 1f
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
        layoutReadyListener = ViewTreeObserver.OnGlobalLayoutListener {
            if (hasMeasuredSize()) {
                tryStartSurfaceAnimation()
            }
        }
        runeRootView?.viewTreeObserver?.addOnGlobalLayoutListener(layoutReadyListener)

        RuneNavigationContainer.registerFragmentSurface(surfaceRootId, this)

        return runeRootView
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
            
            // Fallback: ensure transitions start even if JS never calls back (now set to 5000ms)
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
            runtime.evaluateAsync(jsCode)
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

    private fun startEnterTransitionIfNeeded() {
        if (enterTransitionStarted) return
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
        // <--- ADDED LOG --->
        Log.d("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] tryStartSurfaceAnimation: Checking... (Ready=${surfaceReadyDelivered}, Measured=${hasMeasuredSize()}, Animated=$hasRunEnterAnimation)")

        if (!surfaceReadyDelivered || !hasMeasuredSize() || hasRunEnterAnimation) {
            return
        }

        Log.d("RuneScreenFragment", "🔥 [T=${System.currentTimeMillis() - startTime}ms] tryStartSurfaceAnimation: Fading in view and starting transition...") // <--- ADDED LOG
        val view = runeRootView ?: return
        hasRunEnterAnimation = true
        val width = view.width.toFloat().takeIf { it > 0 } ?: view.resources.displayMetrics.widthPixels.toFloat()
        view.translationX = width
        view.alpha = 0f
        view.animate()
            .translationX(0f)
            .alpha(1f)
            .setDuration(220)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .withStartAction { startEnterTransitionIfNeeded() }
            .start()
        removeLayoutReadyListener()
    }
}
