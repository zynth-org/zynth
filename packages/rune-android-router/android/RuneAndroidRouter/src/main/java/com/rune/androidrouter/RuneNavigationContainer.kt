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
import androidx.lifecycle.Lifecycle
import com.google.android.material.bottomnavigation.BottomNavigationView
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

    private val hostLayout = RuneNavigationHostLayout(activity)
    private val fragmentContainerView = hostLayout.fragmentContainerView
    private val handler = Handler(Looper.getMainLooper())
    private val screenDefinitions = mutableMapOf<String, RouterScreenDefinition>()
    private val fragmentTagCounter = AtomicInteger(0)
    private val tabController = RuneTabController()

    init {
        (runtimeRootView.parent as? ViewGroup)?.removeView(runtimeRootView)
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        runtimeRootView.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        runtimeRootView.visibility = View.GONE
        fragmentContainerView.id = View.generateViewId()
        hostLayout.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        addView(runtimeRootView)
        addView(hostLayout)
        hostLayout.setBottomInsetListener(tabController::onBottomInsetChanged)
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

    fun registerTabs(
        definitions: List<RouterTabDefinition>,
        initialRouteName: String?,
        navigatorOptions: RouterTabBarOptions?,
    ) {
        runOnUiThread {
            tabController.registerTabs(definitions, initialRouteName, navigatorOptions)
        }
    }

    fun switchTab(routeName: String) {
        runOnUiThread {
            tabController.switchTab(routeName)
        }
    }

    fun setTabOptions(routeName: String, options: RouterTabOptions) {
        runOnUiThread {
            tabController.setTabOptions(routeName, options)
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

    private inner class RuneTabController {
        private val bottomNavigationView = BottomNavigationView(context).apply {
            visibility = View.GONE
            setOnItemSelectedListener { item ->
                if (suppressMenuSelection) return@setOnItemSelectedListener true
                val route = routeByMenuItem[item.itemId]
                if (route != null) {
                    selectTab(route)
                    true
                } else {
                    false
                }
            }
        }

        private val tabDefinitions = linkedMapOf<String, RouterTabDefinition>()
        private val fragments = mutableMapOf<String, RouterScreenFragment>()
        private val menuItemIdByRoute = mutableMapOf<String, Int>()
        private val routeByMenuItem = mutableMapOf<Int, String>()
        private var selectedRoute: String? = null
        private var suppressMenuSelection = false
        private val defaultTabBackground = bottomNavigationView.background
        private var tabBarOptions: RouterTabBarOptions? = null
        private var bottomInset = 0

        init {
            hostLayout.setBottomSlotView(bottomNavigationView)
        }

        fun onBottomInsetChanged(inset: Int) {
            bottomInset = inset
            applyBottomInsetPadding()
        }

        fun registerTabs(
            definitions: List<RouterTabDefinition>,
            initialRouteName: String?,
            navigatorOptions: RouterTabBarOptions?,
        ) {
            clearFragments()
            tabDefinitions.clear()
            menuItemIdByRoute.clear()
            routeByMenuItem.clear()
            tabBarOptions = navigatorOptions

            if (definitions.isEmpty()) {
                bottomNavigationView.menu.clear()
                bottomNavigationView.visibility = View.GONE
                selectedRoute = null
                applyTabBarAppearance(null)
                return
            }

            definitions.forEach { definition ->
                tabDefinitions[definition.routeName] = definition
            }
            rebuildMenu(definitions)
            val target = initialRouteName?.takeIf { tabDefinitions.containsKey(it) }
                ?: tabDefinitions.keys.firstOrNull()
            applyTabBarAppearance(target)
            if (target != null) {
                selectTab(target)
            }
        }

        fun switchTab(routeName: String) {
            if (!tabDefinitions.containsKey(routeName)) {
                Log.w(TAG, "Attempted to switch to unknown tab $routeName")
                return
            }
            selectTab(routeName)
        }

        fun setTabOptions(routeName: String, options: RouterTabOptions) {
            val existing = tabDefinitions[routeName] ?: return
            tabDefinitions[routeName] = existing.copy(tabOptions = options)
            menuItemIdByRoute[routeName]?.let { menuId ->
                bottomNavigationView.menu.findItem(menuId)?.title = options.label ?: existing.routeName
            }
            if (selectedRoute == routeName) {
                updateTabBarVisibility(routeName)
                applyTabBarAppearance(routeName)
            }
        }

        private fun rebuildMenu(definitions: List<RouterTabDefinition>) {
            bottomNavigationView.menu.clear()
            definitions.forEachIndexed { index, definition ->
                val menuId = View.generateViewId()
                menuItemIdByRoute[definition.routeName] = menuId
                routeByMenuItem[menuId] = definition.routeName
                val label = definition.tabOptions.label ?: definition.routeName
                bottomNavigationView.menu.add(0, menuId, index, label)
            }
        }

        private fun selectTab(routeName: String) {
            if (selectedRoute == routeName) {
                updateTabBarVisibility(routeName)
                return
            }
            val definition = tabDefinitions[routeName] ?: return
            val targetFragment = fragments[routeName] ?: RouterScreenFragment.newInstance(
                RouterScreenRequest(
                    definition.routeName,
                    null,
                    definition.screenOptions,
                )
            ).also {
                fragments[routeName] = it
            }

            val transaction = fragmentManager().beginTransaction()
            fragments.values.forEach { fragment ->
                if (fragment !== targetFragment) {
                    transaction.hide(fragment)
                    transaction.setMaxLifecycle(fragment, Lifecycle.State.STARTED)
                }
            }
            if (!targetFragment.isAdded) {
                transaction.add(
                    fragmentContainerView.id,
                    targetFragment,
                    "rune-tab-${routeName}"
                )
            }
            transaction.show(targetFragment)
            transaction.setMaxLifecycle(targetFragment, Lifecycle.State.RESUMED)
            transaction.commitNowAllowingStateLoss()

            selectedRoute = routeName
            menuItemIdByRoute[routeName]?.let { menuId ->
                suppressMenuSelection = true
                bottomNavigationView.selectedItemId = menuId
                suppressMenuSelection = false
            }
            updateTabBarVisibility(routeName)
            applyTabBarAppearance(routeName)
        }

        private fun clearFragments() {
            if (fragments.isEmpty()) {
                return
            }
            val transaction = fragmentManager().beginTransaction()
            fragments.values.forEach { fragment ->
                transaction.remove(fragment)
            }
            transaction.commitNowAllowingStateLoss()
            fragments.clear()
            selectedRoute = null
            applyTabBarAppearance(null)
        }

        private fun updateTabBarVisibility(routeName: String) {
            if (!tabDefinitions.containsKey(routeName)) {
                bottomNavigationView.visibility = View.GONE
                return
            }
            val shouldBeVisible = tabDefinitions[routeName]?.tabOptions?.tabBarVisible ?: true
            val targetVisibility = if (shouldBeVisible && tabDefinitions.isNotEmpty()) {
                View.VISIBLE
            } else {
                View.GONE
            }
            if (bottomNavigationView.visibility != targetVisibility) {
                bottomNavigationView.visibility = targetVisibility
            }
        }

        private fun applyTabBarAppearance(routeName: String?) {
            val perRoute = routeName?.let { tabDefinitions[it]?.tabOptions?.tabBarBackgroundColor }
            val resolvedColor = perRoute ?: tabBarOptions?.backgroundColor
            if (resolvedColor != null) {
                bottomNavigationView.setBackgroundColor(resolvedColor)
            } else {
                val background = defaultTabBackground?.constantState?.newDrawable()?.mutate()
                if (background != null) {
                    bottomNavigationView.background = background
                }
            }
        }

        private fun applyBottomInsetPadding() {
            bottomNavigationView.setPadding(
                bottomNavigationView.paddingLeft,
                bottomNavigationView.paddingTop,
                bottomNavigationView.paddingRight,
                bottomInset,
            )
        }
    }
}
