package com.rune.androidrouter

import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentManager
import com.rune.androidrouter.R
import com.rune.kit.core.RuneRootView
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

/**
 * Minimal Android Router - Single screen container for iterating on basic navigation.
 * 
 * This is a deliberately simple implementation to avoid the complexity that causes
 * freezes and rendering issues. Once stable, it will be merged into the main router.
 */
class RuneNavigationContainer {
    private val TAG = "RuneAndroidRouter"
    
    companion object {
        private var currentFragmentManager: FragmentManager? = null
        private var mainRuntime: com.rune.kit.runtime.RuneRuntime? = null
        private val fragmentRegistry = ConcurrentHashMap<Int, WeakReference<RuneScreenFragment>>()
        private var defaultSurfaceId: Int = 0
        
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

        fun notifySurfaceReady(rootId: Int) {
            fragmentRegistry[rootId]?.get()?.onSurfaceReady()
        }

        fun notifySurfaceDisposed(rootId: Int) {
            fragmentRegistry[rootId]?.get()?.onSurfaceDisposed(rootId)
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
    
    companion object {
        private const val ARG_SCREEN_NAME = "screen_name"
        private const val ARG_PARAMS = "params"
        
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
        postponeEnterTransition()
        screenName = arguments?.getString(ARG_SCREEN_NAME)
        arguments?.getString(ARG_PARAMS)?.let {
            params = JSONObject(it)
        }
        
        Log.e("RuneScreenFragment", "🔥🔥🔥 Fragment onCreate: screen=$screenName 🔥🔥🔥")
    }
    
    override fun onCreateView(
        inflater: android.view.LayoutInflater,
        container: android.view.ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        Log.e("RuneScreenFragment", "🔥🔥🔥 onCreateView: screen=$screenName 🔥🔥🔥")
        
        // Allocate a unique rootId for this Fragment surface
        val surfaceRootId = RuneRootView.allocateRootId()
        Log.e("RuneScreenFragment", "🔥 Allocated surfaceRootId=$surfaceRootId for screen=$screenName")
        
        // Create a RuneRootView to host the actual screen content
        runeRootView = RuneRootView(requireContext(), explicitRootId = surfaceRootId).apply {
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
            alpha = 0f
            translationX = 0f
            isClickable = true
            isFocusable = true
            setBackgroundColor(Color.TRANSPARENT)
        }
        enterTransitionStarted = false
        disposalCompleted = false
        lastSurfaceRootId = surfaceRootId
        disposalTimeout = null
        
        RuneNavigationContainer.registerFragmentSurface(surfaceRootId, this)
        
        Log.e("RuneScreenFragment", "🔥 Created RuneRootView with rootId=${runeRootView?.rootId}")
        return runeRootView
    }
    
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        Log.e("RuneScreenFragment", "🔥 onViewCreated for screen: $screenName")

        runeRootView?.let { rootView ->
            Log.e("RuneScreenFragment", "🔥 Fragment rootView created with rootId=${rootView.rootId}")
            
            // Get the main runtime
            val runtime = RuneNavigationContainer.getMainRuntime()
            if (runtime == null) {
                Log.e("RuneScreenFragment", "🔥 ERROR: Main runtime not available!")
                return
            }
            
            Log.e("RuneScreenFragment", "🔥 Got main runtime: $runtime")
            runtime.registerSurface(rootView)
            runtime.setActiveSurface(rootView.rootId)

            val surfaceId = rootView.rootId
            val readyListener = {
                RuneNavigationContainer.notifySurfaceReady(surfaceId)
            }
            surfaceReadyListener = readyListener
            runtime.addSurfaceFirstFrameListener(surfaceId, readyListener)
            
            // Fallback: ensure transitions start even if JS never calls back
            rootView.postDelayed({
                RuneNavigationContainer.notifySurfaceReady(rootView.rootId)
            }, 600)
            
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
            
            Log.e("RuneScreenFragment", "🔥 Evaluating JS to render screen into rootId=${rootView.rootId}")
            runtime.evaluateAsync(jsCode)
        }
    }
    
    override fun onDestroyView() {
        super.onDestroyView()
        Log.e("RuneScreenFragment", "🔥 onDestroyView for screen: $screenName")
        
        val runtime = RuneNavigationContainer.getMainRuntime()
        val rootId = runeRootView?.rootId ?: lastSurfaceRootId
        val listener = surfaceReadyListener
        if (runtime != null && rootId != null && listener != null) {
            runtime.removeSurfaceFirstFrameListener(rootId, listener)
        }
        surfaceReadyListener = null
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

        view?.post {
            try {
                startPostponedEnterTransition()
            } catch (t: Throwable) {
                Log.w("RuneScreenFragment", "Failed to start postponed transition", t)
            }
        }
    }

    fun onSurfaceReady() {
        runeRootView?.animate()
            ?.alpha(1f)
            ?.setDuration(180)
            ?.setInterpolator(AccelerateDecelerateInterpolator())
            ?.start()
        startEnterTransitionIfNeeded()
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
}
