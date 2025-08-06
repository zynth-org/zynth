package com.rune.androidrouter

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import androidx.appcompat.widget.Toolbar
import androidx.core.graphics.drawable.DrawableCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import com.google.android.material.appbar.AppBarLayout
import com.google.android.material.appbar.AppBarLayout.LayoutParams as AppBarParams
import com.rune.kit.core.RuneRootView
import org.json.JSONObject

class RouterScreenFragment : Fragment() {

    private var appBarLayout: AppBarLayout? = null
    private var toolbar: Toolbar? = null
    private var contentRoot: RuneRootView? = null
    private var options: RouterScreenOptions = RouterScreenOptions()
    private var disposeRunnable: Runnable? = null
    internal var routeName: String = ""
        private set
    private var paramsJson: String? = null
    private var layoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var contentRendered: Boolean = false
    private var viewMeasured: Boolean = false
    private var readinessNotified: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val args = requireArguments()
        val request = RouterScreenRequest.fromBundle(args)
        routeName = request.routeName
        paramsJson = request.paramsJson
        options = request.options
        Log.d(TAG, "onCreate route=$routeName params=$paramsJson options=$options")
        postponeEnterTransition()
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        val context = requireContext()
        Log.d(TAG, "onCreateView route=$routeName")
        
        // DON'T set layoutParams on root - Fragment container will apply its own
        val root = android.widget.LinearLayout(context).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            fitsSystemWindows = false
            // setBackgroundColor(Color.TRANSPARENT)
        }

        val appBar = AppBarLayout(context)
        val toolbar = Toolbar(context)
        appBar.addView(toolbar, AppBarParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ))
        root.addView(appBar, android.widget.LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ))

        val content = RuneRootView(context)
        val contentHost = FrameLayout(context).apply {
            addView(content, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ))
        }
        root.addView(contentHost, android.widget.LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f // weight = 1 to fill remaining space
        ))

        this.toolbar = toolbar
        this.appBarLayout = appBar
        contentRoot = content

        RuneAndroidRouterHost.containerOrNull()?.registerFragmentSurface(content.rootId, this)

        applyStatusBarInsetPadding(root, appBar)

        Log.d(TAG, "registerSurface >>> route=$routeName rootId=${content.rootId}")
        RuneAndroidRouterHost.requireRuntime().registerSurface(content)
        focusSurface("registered")
        applyOptions(options)
        trackLayout(content)

        return root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        Log.d(TAG, "onViewCreated route=$routeName")
        focusSurface("onViewCreated")
        renderScreen()
    }

    override fun onResume() {
        super.onResume()
        focusSurface("onResume")
        updateToolbarNavigation()
    }

    override fun onDestroyView() {
        val root = contentRoot
        val surfaceId = root?.rootId
        layoutListener?.let { listener ->
            root?.viewTreeObserver?.removeOnGlobalLayoutListener(listener)
        }
        layoutListener = null

        surfaceId?.let { id ->
            if (shouldDelaySurfaceDispose()) {
                scheduleSurfaceDispose(id, root)
            } else {
                disposeSurface(id)
            }
        }

        contentRendered = false
        viewMeasured = false
        readinessNotified = false
        toolbar = null
        appBarLayout = null
        contentRoot = null
        super.onDestroyView()
    }

    internal fun markContentRendered() {
        contentRendered = true
        notifyReadinessIfNeeded()
    }

    internal fun hasRenderedContent(): Boolean = contentRendered

    internal fun presentation(): RouterScreenPresentation = options.presentation

    fun updateParams(params: JSONObject?) {
        val newParams = params?.toString()
        if (paramsJson == newParams) return
        paramsJson = newParams
        Log.d(TAG, "updateParams route=$routeName params=$paramsJson")
        if (contentRoot != null) {
            renderScreen()
        }
    }

    private fun notifyReadinessIfNeeded() {
        if (contentRendered && viewMeasured && !readinessNotified) {
            readinessNotified = true
            startPostponedEnterTransition()
            RuneAndroidRouterHost.containerOrNull()?.onFragmentContentReady(this)
        }
    }

    private fun shouldDelaySurfaceDispose(): Boolean {
        if (options.presentation == RouterScreenPresentation.MODAL) {
            return true
        }
        // Delay disposal during animated stack pops to avoid tearing/flicker.
        return isRemoving
    }

    private fun scheduleSurfaceDispose(surfaceId: Int, hostView: View?) {
        disposeRunnable?.let { root ->
            hostView?.removeCallbacks(root)
        }
        val runnable = Runnable {
            disposeSurface(surfaceId)
        }
        disposeRunnable = runnable
        val delayHost = hostView ?: return runnable.run()
        delayHost.postDelayed(runnable, EXIT_DISPOSE_DELAY_MS)
    }

    private fun disposeSurface(surfaceId: Int) {
        disposeRunnable = null
        val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
        focusSurface(surfaceId, "dispose")
        sendDispose(surfaceId)
        runtime.unregisterSurface(surfaceId)
        RuneAndroidRouterHost.containerOrNull()?.unregisterFragmentSurface(surfaceId)
    }

    private fun renderScreen() {
        val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
        val root = contentRoot ?: return
        focusSurface("render")
        val paramsExpression = paramsJson ?: "null"
        Log.d(TAG, "renderScreen route=$routeName rootId=${root.rootId} params=$paramsExpression")
        val nameLiteral = JSONObject.quote(routeName)
        val script = """
            (function(){
              const render = globalThis.__renderRouterScreen;
              if (typeof render === 'function') {
                render(${root.rootId}, $nameLiteral, $paramsExpression);
              } else {
                console.warn('[RuneAndroidRouter] render function missing');
              }
            })();
        """.trimIndent()
        runtime.evaluateAsync(script)
    }

    private fun sendDispose(surfaceId: Int) {
        val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
        Log.d(TAG, "sendDispose route=$routeName surfaceId=$surfaceId")
        val script = """
            (function(){
              const dispose = globalThis.__disposeRouterScreen;
              if (typeof dispose === 'function') {
                dispose($surfaceId);
              }
            })();
        """.trimIndent()
        runtime.evaluateAsync(script)
    }

    fun applyOptions(next: RouterScreenOptions) {
        options = next
        val toolbar = toolbar ?: return
        val appBar = appBarLayout
        val resolvedTitle = next.title ?: routeName
        toolbar.title = resolvedTitle
        toolbar.subtitle = next.subtitle
        val tint = next.headerTintColor ?: Color.WHITE
        toolbar.setTitleTextColor(tint)
        toolbar.setSubtitleTextColor(tint)
        val backgroundColor = if (next.headerTransparent) {
            Color.TRANSPARENT
        } else {
            next.headerBackgroundColor ?: resolveDefaultAppBarColor()
        }
        appBar?.setBackgroundColor(backgroundColor)
        appBar?.elevation = if (next.headerShadowVisible) defaultAppBarElevation() else 0f
        appBar?.visibility = if (next.headerShown) View.VISIBLE else View.GONE
        updateToolbarNavigation()
    }

    private fun resolveDefaultAppBarColor(): Int {
        val typedArray = context?.theme?.obtainStyledAttributes(intArrayOf(android.R.attr.colorPrimary))
        val color = typedArray?.getColor(0, Color.BLACK) ?: Color.BLACK
        typedArray?.recycle()
        return color
    }

    private fun updateToolbarNavigation() {
        val toolbar = toolbar ?: return
        val canGoBack = parentFragmentManager.backStackEntryCount > 1
        val tint = options.headerTintColor ?: Color.WHITE
        if (canGoBack) {
            toolbar.setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_ab_back_material)
            toolbar.setNavigationOnClickListener {
                RuneAndroidRouterHost.containerOrNull()?.goBack()
            }
        } else {
            toolbar.navigationIcon = null
            toolbar.setNavigationOnClickListener(null)
        }
        toolbar.navigationIcon?.let { icon ->
            DrawableCompat.wrap(icon).mutate().setTint(tint)
        }
    }

    private fun trackLayout(root: RuneRootView) {
        layoutListener?.let { root.viewTreeObserver.removeOnGlobalLayoutListener(it) }
        if (root.width > 0 && root.height > 0) {
            viewMeasured = true
            notifyReadinessIfNeeded()
            return
        }
        val listener = ViewTreeObserver.OnGlobalLayoutListener {
            val width = root.width
            val height = root.height
            if (width > 0 && height > 0) {
                Log.d(TAG, "Screen $routeName measured ${width}x$height")
                viewMeasured = true
                notifyReadinessIfNeeded()
                layoutListener?.let { existing ->
                    root.viewTreeObserver.removeOnGlobalLayoutListener(existing)
                }
                layoutListener = null
            }
        }
        layoutListener = listener
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
    }

    private fun applyStatusBarInsetPadding(container: View, appBar: AppBarLayout) {
        ViewCompat.setOnApplyWindowInsetsListener(container) { _, insets ->
            val topInset = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            if (appBar.paddingTop != topInset) {
                appBar.setPadding(
                    appBar.paddingLeft,
                    topInset,
                    appBar.paddingRight,
                    appBar.paddingBottom,
                )
            }
            insets
        }
        ViewCompat.requestApplyInsets(container)
    }

    private fun focusSurface(reason: String) {
        val surfaceId = contentRoot?.rootId ?: return
        focusSurface(surfaceId, reason)
    }

    private fun focusSurface(surfaceId: Int, reason: String) {
        val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
        runtime.setActiveSurface(surfaceId)
        Log.d(TAG, "focusSurface[$reason] route=$routeName surfaceId=$surfaceId")
    }

    private fun defaultAppBarElevation(): Float {
        val density = context?.resources?.displayMetrics?.density ?: 0f
        return 4f * density
    }

    companion object {
        private const val TAG = "RuneRouterScreen"
        private const val EXIT_DISPOSE_DELAY_MS = 300L

        fun newInstance(request: RouterScreenRequest): RouterScreenFragment {
            val fragment = RouterScreenFragment()
            fragment.arguments = request.toBundle()
            return fragment
        }
    }
}
