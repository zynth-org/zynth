package com.rune.androidrouter

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentManager
import androidx.fragment.app.FragmentTransaction
import androidx.fragment.app.FragmentContainerView
import com.rune.kit.core.RuneRootView
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "RuneAndroidRouter"
private const val EVENT_STACK_CHANGED = "rune.androidRouter.stackChanged"
private const val EVENT_BACK_PRESS = "rune.androidRouter.backPress"

internal class RuneNavigationContainer(
    private val activity: FragmentActivity,
    private val runtime: RuneRuntime,
    private val runtimeRootView: RuneRootView,
) : FrameLayout(activity) {

    private val fragmentContainerView: FragmentContainerView = FragmentContainerView(context)
    private val handler = Handler(Looper.getMainLooper())
    private val screenDefinitions = mutableMapOf<String, RouterScreenDefinition>()
    private val fragmentTagCounter = AtomicInteger(0)

    init {
        (runtimeRootView.parent as? ViewGroup)?.removeView(runtimeRootView)
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        runtimeRootView.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        runtimeRootView.visibility = View.GONE
        fragmentContainerView.id = View.generateViewId()
        fragmentContainerView.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        addView(runtimeRootView)
        addView(fragmentContainerView)
        fragmentManager().addOnBackStackChangedListener {
            emitStackSnapshot("backStackChanged")
        }
    }

    fun attachToActivity() {
        runOnUiThread {
            (runtimeRootView.parent as? ViewGroup)?.removeView(runtimeRootView)
            activity.setContentView(this)
            emitStackSnapshot("attached")
        }
    }

    fun fragmentManager(): FragmentManager = activity.supportFragmentManager

    fun registerScreens(definitions: List<RouterScreenDefinition>) {
        Log.d(TAG, "registerScreens definitions=${definitions.map { it.name }} size=${definitions.size}")
        screenDefinitions.clear()
        definitions.forEach { definition ->
            screenDefinitions[definition.name] = definition
        }
        Log.i(TAG, "Registered ${definitions.size} router screens")
        emitStackSnapshot("screensRegistered")
    }

    fun reset(initialRouteName: String?) {
        Log.d(TAG, "reset requested initialRoute=$initialRouteName")
        runOnUiThread {
            clearBackStack()
            val targetRoute = initialRouteName ?: screenDefinitions.keys.firstOrNull()
            if (targetRoute == null) {
                Log.w(TAG, "reset requested but no screens registered")
                return@runOnUiThread
            }
            push(targetRoute, null, animate = false)
        }
    }

    fun navigate(routeName: String, params: JSONObject?) {
        Log.d(TAG, "navigate route=$routeName params=$params")
        runOnUiThread {
            push(routeName, params, animate = true)
        }
    }

    fun goBack() {
        runOnUiThread {
            val handled = if (fragmentManager().backStackEntryCount > 0) {
                fragmentManager().popBackStackImmediate()
                true
            } else {
                activity.onBackPressedDispatcher.onBackPressed()
                false
            }
            emitBackPressEvent("runtime", handled)
        }
    }

    fun applyOptions(options: RouterScreenOptions) {
        runOnUiThread {
            val fragment = topScreenFragment()
            fragment?.applyOptions(options)
            val route = fragment?.routeName ?: return@runOnUiThread
            val existing = screenDefinitions[route]
            if (existing != null) {
                screenDefinitions[route] = existing.copy(options = options)
            }
        }
    }

    private fun push(routeName: String, params: JSONObject?, animate: Boolean) {
        Log.d(TAG, "push route=$routeName animate=$animate screenDefinitionsKeys=${screenDefinitions.keys}")
        val definition = screenDefinitions[routeName]
        if (definition == null) {
            Log.w(TAG, "Cannot navigate to $routeName; not registered")
            return
        }
        val request = RouterScreenRequest(
            routeName = definition.name,
            paramsJson = params?.toString(),
            options = definition.options,
        )
        val fragment = RouterScreenFragment.newInstance(request)
        val transaction = fragmentManager().beginTransaction()
        if (animate) {
            transaction.setTransition(FragmentTransaction.TRANSIT_FRAGMENT_OPEN)
        }
        val tag = "rune-screen-${fragmentTagCounter.incrementAndGet()}"
        transaction.add(fragmentContainerView.id, fragment, tag)
            .addToBackStack(tag)
            .commitAllowingStateLoss()
        emitStackSnapshot("push:$routeName")
    }

    private fun clearBackStack() {
        val manager = fragmentManager()
        manager.popBackStackImmediate(null, FragmentManager.POP_BACK_STACK_INCLUSIVE)
        val fragments = manager.fragments.toList()
        if (fragments.isEmpty()) {
            return
        }
        manager.beginTransaction().apply {
            fragments.forEach { fragment ->
                remove(fragment)
            }
            commitNowAllowingStateLoss()
        }
        emitStackSnapshot("cleared")
    }

    private fun topScreenFragment(): RouterScreenFragment? {
        val fragments = fragmentManager().fragments
        for (index in fragments.indices.reversed()) {
            val fragment = fragments[index]
            if (fragment is RouterScreenFragment && fragment.isAdded && fragment.view != null) {
                return fragment
            }
        }
        return null
    }

    private fun runOnUiThread(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            handler.post(block)
        }
    }

    private fun emitStackSnapshot(reason: String) {
        val fragments = fragmentManager().fragments
            .filterIsInstance<RouterScreenFragment>()
            .filter { it.isAdded }
        val routes = fragments.map { it.routeName }
        Log.d(TAG, "stackChanged reason=$reason stack=$routes managerFragments=${fragmentManager().fragments.map { it::class.simpleName }}")
        val payload = mapOf(
            "routes" to routes,
            "stackLength" to routes.size,
            "canGoBack" to (routes.size > 1),
            "reason" to reason,
        )
        runtime.emitEvent(EVENT_STACK_CHANGED, payload)
    }

    private fun emitBackPressEvent(source: String, handled: Boolean) {
        val payload = mapOf(
            "source" to source,
            "handled" to handled,
        )
        Log.d(TAG, "backPress source=$source handled=$handled")
        runtime.emitEvent(EVENT_BACK_PRESS, payload)
    }
}
