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
    internal var routeName: String = ""
        private set
    private var paramsJson: String? = null
    private var layoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val args = requireArguments()
        val request = RouterScreenRequest.fromBundle(args)
        routeName = request.routeName
        paramsJson = request.paramsJson
        options = request.options
        Log.d(TAG, "onCreate route=$routeName params=$paramsJson options=$options")
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
            fitsSystemWindows = true
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

        Log.d(TAG, "registerSurface >>> route=$routeName rootId=${content.rootId}")
        RuneAndroidRouterHost.requireRuntime().registerSurface(content)
        applyOptions(options)
        trackLayout(content)

        return root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        Log.d(TAG, "onViewCreated route=$routeName")
        renderScreen()
    }

    override fun onResume() {
        super.onResume()
        updateToolbarNavigation()
    }

    override fun onDestroyView() {
        val root = contentRoot
        val surfaceId = root?.rootId
        root?.let { RuneAndroidRouterHost.runtimeOrNull()?.unregisterSurface(it.rootId) }
        layoutListener?.let { listener ->
            root?.viewTreeObserver?.removeOnGlobalLayoutListener(listener)
        }
        layoutListener = null
        toolbar = null
        appBarLayout = null
        contentRoot = null
        if (surfaceId != null) {
            sendDispose(surfaceId)
        }
        super.onDestroyView()
    }

    private fun renderScreen() {
        val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
        val root = contentRoot ?: return
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
        val tint = next.headerTintColor ?: Color.WHITE
        toolbar.setTitleTextColor(tint)
        appBar?.setBackgroundColor(next.headerBackgroundColor ?: resolveDefaultAppBarColor())
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
        if (canGoBack) {
            toolbar.setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_ab_back_material)
            toolbar.setNavigationOnClickListener {
                RuneAndroidRouterHost.containerOrNull()?.goBack()
            }
        } else {
            toolbar.navigationIcon = null
            toolbar.setNavigationOnClickListener(null)
        }
    }

    private fun trackLayout(root: RuneRootView) {
        layoutListener?.let { root.viewTreeObserver.removeOnGlobalLayoutListener(it) }
        val listener = ViewTreeObserver.OnGlobalLayoutListener {
            val width = root.width
            val height = root.height
            if (width > 0 && height > 0) {
                Log.d(TAG, "Screen $routeName measured ${width}x$height")
                layoutListener?.let { existing ->
                    root.viewTreeObserver.removeOnGlobalLayoutListener(existing)
                }
                layoutListener = null
            }
        }
        layoutListener = listener
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
    }

    companion object {
        private const val TAG = "RuneRouterScreen"

        fun newInstance(request: RouterScreenRequest): RouterScreenFragment {
            val fragment = RouterScreenFragment()
            fragment.arguments = request.toBundle()
            return fragment
        }
    }
}
