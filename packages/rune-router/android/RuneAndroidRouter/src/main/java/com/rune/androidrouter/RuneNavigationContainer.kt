package com.rune.androidrouter

import android.content.res.ColorStateList
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.Gravity
import android.widget.FrameLayout
import android.graphics.Color
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentManager
import androidx.fragment.app.FragmentTransaction
import androidx.fragment.app.FragmentContainerView
import androidx.lifecycle.Lifecycle
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.navigation.NavigationBarItemView
import com.google.android.material.navigation.NavigationBarMenuView
import com.google.android.material.navigation.NavigationBarView
import com.google.android.material.color.MaterialColors
import com.rune.kit.core.RuneRootView
import com.rune.androidrouter.R
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToInt

private const val TAG = "RuneAndroidRouter"
private const val EVENT_STACK_CHANGED = "rune.androidRouter.stackChanged"
private const val EVENT_BACK_PRESS = "rune.androidRouter.backPress"
private const val ROUTER_EVENT_STATE_CHANGED = "rune.router.stateChanged"
private const val ROUTER_EVENT_FOCUS = "rune.router.focus"
private const val ROUTER_EVENT_BLUR = "rune.router.blur"
private const val ROUTER_EVENT_BACK = "rune.router.back"
private const val FIRST_FRAME_TIMEOUT_MS = 1000L

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
    private var modalOverlayActive = false
    private val fragmentBySurfaceId = mutableMapOf<Int, RouterScreenFragment>()
    private val firstFrameTimeouts = mutableMapOf<Int, Runnable>()
    private var routerActive = false
    private val bottomSheetHost = BottomSheetNavigatorHost(activity)
    private var lastFocusedKey: String? = null
    private var lastRoutesSnapshot: List<String> = emptyList()

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
        setRouterActive(false)
    }

    fun attachToActivity() {
        runOnUiThread {
            if (runtimeRootView.parent !== this) {
                (runtimeRootView.parent as? ViewGroup)?.removeView(runtimeRootView)
                addView(runtimeRootView, 0)
            }
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
        val stackScreensPresent = definitions.any { it.target == RouterScreenTarget.STACK }
        setRouterActive(stackScreensPresent)
        emitStackSnapshot("screensRegistered")
    }

    fun reset(initialRouteName: String?) {
        Log.d(TAG, "reset requested initialRoute=$initialRouteName")
        runOnUiThread {
            clearBackStack()
            val preferred = initialRouteName?.takeIf { route ->
                screenDefinitions[route]?.target == RouterScreenTarget.STACK
            }
            val targetRoute = preferred ?: screenDefinitions.values
                .firstOrNull { it.target == RouterScreenTarget.STACK }
                ?.name
            if (targetRoute == null) {
                Log.w(TAG, "reset requested but no stack screens registered")
                return@runOnUiThread
            }
            val definition = screenDefinitions[targetRoute]
            if (definition?.target == RouterScreenTarget.BOTTOM_SHEET) {
                Log.d(TAG, "reset target=$targetRoute maps to bottom sheet; skipping stack reset")
                return@runOnUiThread
            }
            push(targetRoute, null, animate = false)
        }
    }

    fun navigate(routeName: String, params: JSONObject?) {
        Log.d(TAG, "navigate route=$routeName params=$params")
        runOnUiThread {
            if (tabController.hasRoute(routeName)) {
                if (params != null) {
                    Log.d(TAG, "navigate route=$routeName resolved to tab; params will be ignored in tab switch")
                }
                tabController.switchTab(routeName)
                return@runOnUiThread
            }
            if (bottomSheetHost.handleNavigate(routeName, params)) {
                return@runOnUiThread
            }
            push(routeName, params, animate = true)
        }
    }

    fun goBack() {
        runOnUiThread {
            if (bottomSheetHost.handleGoBack()) {
                return@runOnUiThread
            }
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
            // Drop any existing stack-managed fragments before wiring up tabs to avoid duplicates.
            clearBackStack()
            tabController.registerTabs(definitions, initialRouteName, navigatorOptions)
            if (definitions.isNotEmpty()) {
                setRouterActive(true)
            }
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

    fun currentState(): Map<String, Any?> = buildNavigationState()

    fun dispatch(type: String, action: Map<String, Any?>) {
        when (type) {
            "NAVIGATE", "PUSH" -> {
                val payload = action["payload"].asMap()
                val name = payload?.get("name") as? String ?: return
                val params = payload["params"].asJSONObject()
                navigate(name, params)
            }
            "POP" -> {
                goBack()
            }
            "REPLACE" -> {
                val payload = action["payload"].asMap()
                val name = payload?.get("name") as? String ?: return
                val params = payload["params"].asJSONObject()
                goBack()
                navigate(name, params)
            }
            "RESET" -> {
                val state = action["state"].asMap()
                val routes = state?.get("routes").asList().orEmpty()
                val first = routes.firstOrNull().asMap()
                val name = first?.get("name") as? String
                reset(name)
            }
            "SET_PARAMS" -> {
                Log.w(TAG, "SET_PARAMS not implemented on Android")
            }
            else -> Log.w(TAG, "Unsupported dispatch type=$type")
        }
    }

    fun registerFragmentSurface(surfaceId: Int, fragment: RouterScreenFragment) {
        fragmentBySurfaceId[surfaceId] = fragment
    }

    fun unregisterFragmentSurface(surfaceId: Int) {
        fragmentBySurfaceId.remove(surfaceId)
        firstFrameTimeouts.remove(surfaceId)?.let(handler::removeCallbacks)
    }

    fun registerBottomSheetNavigator(config: RouterBottomSheetNavigatorConfig) {
        runOnUiThread {
            bottomSheetHost.register(config)
        }
    }

    fun notifyScreenRendered(surfaceId: Int) {
        runOnUiThread {
            val fragment = fragmentBySurfaceId[surfaceId]
            if (fragment == null) {
                if (bottomSheetHost.notifyScreenRendered(surfaceId)) {
                    return@runOnUiThread
                }
                return@runOnUiThread
            }
            val deferred = runCatching {
                runtime.addSurfaceFirstFrameListener(surfaceId) {
                    runOnUiThread {
                        firstFrameTimeouts.remove(surfaceId)?.let(handler::removeCallbacks)
                        val stillActive = fragmentBySurfaceId[surfaceId]
                        if (stillActive == fragment) {
                            stillActive.markContentRendered()
                        }
                    }
                }
                scheduleFirstFrameTimeout(surfaceId, fragment)
                true
            }.getOrElse { error ->
                Log.w(TAG, "Failed to defer screenRendered for surface=$surfaceId", error)
                false
            }
            if (!deferred) {
                fragment.markContentRendered()
            }
        }
    }
    
    private fun scheduleFirstFrameTimeout(surfaceId: Int, fragment: RouterScreenFragment) {
        firstFrameTimeouts.remove(surfaceId)?.let(handler::removeCallbacks)
        val runnable = Runnable {
            val stillActive = fragmentBySurfaceId[surfaceId]
            if (stillActive == fragment) {
                Log.w(TAG, "First frame timeout for surface=$surfaceId; marking content rendered")
                stillActive.markContentRendered()
            }
            firstFrameTimeouts.remove(surfaceId)
        }
        firstFrameTimeouts[surfaceId] = runnable
        handler.postDelayed(runnable, FIRST_FRAME_TIMEOUT_MS)
    }

    fun onFragmentContentReady(fragment: RouterScreenFragment) {
        runOnUiThread {
            tabController.onFragmentReady(fragment)
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
        transaction.applyPresentationAnimation(definition.options, animate)

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
            if (
                fragment is RouterScreenFragment &&
                fragment.isAdded &&
                fragment.view != null &&
                !fragment.isHidden
            ) {
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
        if (routes == lastRoutesSnapshot) {
            return
        }
        lastRoutesSnapshot = routes
        Log.d(TAG, "stackChanged reason=$reason stack=$routes managerFragments=${fragmentManager().fragments.map { it::class.simpleName }}")
        val payload = mapOf(
            "routes" to routes,
            "stackLength" to routes.size,
            "canGoBack" to (routes.size > 1),
            "reason" to reason,
        )
        runtime.emitEvent(EVENT_STACK_CHANGED, payload)
        runtime.emitEvent(ROUTER_EVENT_STATE_CHANGED, mapOf("state" to buildNavigationState()))
        val nextFocused = routes.lastOrNull()
        if (nextFocused != null && nextFocused != lastFocusedKey) {
            lastFocusedKey?.let { prev ->
                runtime.emitEvent(ROUTER_EVENT_BLUR, mapOf("key" to prev))
            }
            runtime.emitEvent(ROUTER_EVENT_FOCUS, mapOf("key" to nextFocused))
            lastFocusedKey = nextFocused
        }
        updateModalOverlayState(fragments)
    }

    private fun updateModalOverlayState(
        fragments: List<RouterScreenFragment>? = null,
    ) {
        val stack = fragments ?: fragmentManager().fragments
            .filterIsInstance<RouterScreenFragment>()
        val hasModal = stack.any { fragment ->
            fragment.isAdded &&
                !fragment.isHidden &&
                fragment.presentation() == RouterScreenPresentation.MODAL
        }
        if (hasModal == modalOverlayActive) {
            return
        }
        modalOverlayActive = hasModal
        if (!hasModal) {
            tabController.clearPendingSnapshot()
        }
        hostLayout.setModalOverlayActive(hasModal)
    }

    private fun emitBackPressEvent(source: String, handled: Boolean) {
        val payload = mapOf(
            "source" to source,
            "handled" to handled,
        )
        Log.d(TAG, "backPress source=$source handled=$handled")
        runtime.emitEvent(EVENT_BACK_PRESS, payload)
        runtime.emitEvent(ROUTER_EVENT_BACK, mapOf("source" to source))
    }

    private fun buildNavigationState(): Map<String, Any?> {
        val fragments = fragmentManager().fragments
            .filterIsInstance<RouterScreenFragment>()
            .filter { it.isAdded }
        val routes = fragments.mapIndexed { index, fragment ->
            mapOf(
                "key" to "${fragment.routeName}-$index",
                "name" to fragment.routeName,
            )
        }
        val topIndex = if (routes.isNotEmpty()) routes.size - 1 else 0
        return mapOf(
            "key" to "stack-root",
            "type" to "stack",
            "index" to topIndex,
            "routes" to routes,
        )
    }

    private fun setRouterActive(active: Boolean) {
        if (routerActive == active) {
            return
        }
        val wasActive = routerActive
        routerActive = active
        if (active) {
            runtimeRootView.visibility = View.GONE
            hostLayout.visibility = View.VISIBLE
        } else {
            hostLayout.visibility = View.GONE
            runtimeRootView.visibility = View.VISIBLE
            if (wasActive) {
                runOnUiThread {
                    clearBackStack()
                }
            }
        }
    }

    private inner class RuneTabController {
        private val bottomNavigationView = BottomNavigationView(context).apply {
            visibility = View.GONE
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
        private val iconHostsByRoute = mutableMapOf<String, RuneTabIconHostView>()
        private var awaitingRenderedRoute: String? = null
        private var pendingRouteSelection: String? = null
    private var fragmentAwaitingHide: RouterScreenFragment? = null

        init {
            hostLayout.setBottomSlotView(bottomNavigationView)
            bottomNavigationView.labelVisibilityMode = NavigationBarView.LABEL_VISIBILITY_LABELED
            bottomNavigationView.setOnItemSelectedListener { item ->
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

        fun onBottomInsetChanged(inset: Int) {
            bottomInset = inset
            applyBottomInsetPadding()
        }

        fun hasRoute(routeName: String): Boolean {
            return tabDefinitions.containsKey(routeName)
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
            iconHostsByRoute.values.forEach { host ->
                removeHostView(host)
            }
            iconHostsByRoute.clear()
            tabBarOptions = navigatorOptions

            if (definitions.isEmpty()) {
                bottomNavigationView.menu.clear()
                bottomNavigationView.visibility = View.GONE
                selectedRoute = null
                applyTabBarAppearance(null)
                updateNavigationColors()
                return
            }

            definitions.forEach { definition ->
                tabDefinitions[definition.routeName] = definition
            }
            rebuildMenu(definitions)
            val target = initialRouteName?.takeIf { tabDefinitions.containsKey(it) }
                ?: tabDefinitions.keys.firstOrNull()
            applyTabBarAppearance(target)
            refreshTabIcons()
            updateNavigationColors()
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
            refreshTabIcons()
            updateNavigationColors()
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
            if (pendingRouteSelection == routeName) {
                return
            }
            if (fragmentAwaitingHide?.isAdded == true && fragmentAwaitingHide?.isHidden == true) {
                fragmentAwaitingHide = null
            }
            if (pendingRouteSelection == null && selectedRoute == routeName) {
                updateTabBarVisibility(routeName)
                hostLayout.hideContentSnapshot()
                awaitingRenderedRoute = null
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

            if (!targetFragment.isAdded) {
                fragmentManager().beginTransaction()
                    .add(
                        fragmentContainerView.id,
                        targetFragment,
                        "rune-tab-${routeName}"
                    )
                    .commitNowAllowingStateLoss()
            }

            val currentFragment = selectedRoute?.let { fragments[it] }
            val needsSnapshot = currentFragment != null && !targetFragment.hasRenderedContent()
            fragmentAwaitingHide = if (needsSnapshot) currentFragment else null
            val snapshotCreated = if (needsSnapshot) {
                hostLayout.showContentSnapshot()
            } else {
                false
            }

            if (needsSnapshot && !snapshotCreated) {
                pendingRouteSelection = routeName
                return
            }

            if (snapshotCreated) {
                awaitingRenderedRoute = routeName
            } else {
                awaitingRenderedRoute = null
                hostLayout.hideContentSnapshot()
                if (!needsSnapshot) {
                    fragmentAwaitingHide = null
                }
            }

            pendingRouteSelection = null
            activateTab(routeName, targetFragment, needsSnapshot)
        }

        fun onFragmentReady(fragment: RouterScreenFragment) {
            if (fragment.routeName == pendingRouteSelection) {
                pendingRouteSelection = null
                selectTab(fragment.routeName)
                return
            }
            if (fragment.routeName == awaitingRenderedRoute) {
                awaitingRenderedRoute = null
                hostLayout.hideContentSnapshot()
                completeDeferredHide()
            }
        }

        fun clearPendingSnapshot() {
            pendingRouteSelection = null
            awaitingRenderedRoute = null
            hostLayout.hideContentSnapshot()
            completeDeferredHide()
        }

        private fun activateTab(routeName: String, targetFragment: RouterScreenFragment, delayHidePrevious: Boolean) {
            val transaction = fragmentManager().beginTransaction()
            transaction.show(targetFragment)
            transaction.setMaxLifecycle(targetFragment, Lifecycle.State.RESUMED)
            fragments.values.forEach { fragment ->
                if (fragment !== targetFragment) {
                    val shouldHideNow = !(delayHidePrevious && fragment === fragmentAwaitingHide)
                    if (shouldHideNow) {
                        transaction.hide(fragment)
                    } else {
                        transaction.show(fragment)
                    }
                    transaction.setMaxLifecycle(fragment, Lifecycle.State.STARTED)
                }
            }
            transaction.commitNowAllowingStateLoss()
            if (!delayHidePrevious) {
                fragmentAwaitingHide = null
            }

            selectedRoute = routeName
            menuItemIdByRoute[routeName]?.let { menuId ->
                suppressMenuSelection = true
                bottomNavigationView.selectedItemId = menuId
                suppressMenuSelection = false
            }
            updateTabBarVisibility(routeName)
            applyTabBarAppearance(routeName)
            updateIconActiveStates()
        }

        private fun clearFragments() {
            if (fragments.isEmpty()) {
                return
            }
            val transaction = fragmentManager().beginTransaction()
            fragments.values.forEach { fragment ->
                if (fragment.isAdded) {
                    transaction.remove(fragment)
                }
            }
            transaction.commitNowAllowingStateLoss()
            fragments.clear()
            selectedRoute = null
            awaitingRenderedRoute = null
            pendingRouteSelection = null
            hostLayout.hideContentSnapshot()
            applyTabBarAppearance(null)
            iconHostsByRoute.values.forEach { host ->
                removeHostView(host)
            }
            iconHostsByRoute.clear()
            updateNavigationColors()
            fragmentAwaitingHide = null
        }

        private fun completeDeferredHide() {
            val fragment = fragmentAwaitingHide ?: return
            fragmentAwaitingHide = null
            if (!fragment.isAdded || fragment.isHidden) {
                return
            }
            fragmentManager().beginTransaction()
                .hide(fragment)
                .setMaxLifecycle(fragment, Lifecycle.State.STARTED)
                .commitNowAllowingStateLoss()
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

        private fun refreshTabIcons() {
            val menuView = bottomNavigationView.getChildAt(0) as? NavigationBarMenuView ?: return
            for (index in 0 until menuView.childCount) {
                val itemView = menuView.getChildAt(index) as? NavigationBarItemView ?: continue
                val menuItem = bottomNavigationView.menu.getItem(index)
                val route = routeByMenuItem[menuItem.itemId] ?: continue
                val descriptor = tabDefinitions[route]?.tabOptions?.icon
                if (descriptor?.runeId != null) {
                    val host = ensureHostView(itemView)
                    iconHostsByRoute[route] = host
                    host.bindIcon(descriptor.runeId, isRouteSelected(route))
                } else {
                    iconHostsByRoute.remove(route)?.let { host ->
                        removeHostView(host)
                    }
                    restoreDefaultIconView(itemView)
                }
            }
        }

        private fun updateIconActiveStates() {
            iconHostsByRoute.forEach { (route, host) ->
                val runeId = tabDefinitions[route]?.tabOptions?.icon?.runeId ?: return@forEach
                host.bindIcon(runeId, isRouteSelected(route))
            }
        }

        private fun ensureHostView(itemView: NavigationBarItemView): RuneTabIconHostView {
            val container = itemView.findViewById<ViewGroup>(
                com.google.android.material.R.id.navigation_bar_item_icon_container,
            ) ?: itemView
            val iconView = container.findViewById<View>(
                com.google.android.material.R.id.navigation_bar_item_icon_view,
            )
            val existing = container.findViewWithTag<RuneTabIconHostView>("rune-tab-icon-host")
            if (existing != null) {
                hideDefaultIconView(container)
                val size = resolveIconSize(iconView)
                existing.updateDesiredSize(size.first, size.second)
                existing.visibility = View.VISIBLE
                return existing
            }
            val host = RuneTabIconHostView(container.context).apply {
                tag = "rune-tab-icon-host"
            }
            val size = resolveIconSize(iconView)
            val layoutParams = FrameLayout.LayoutParams(size.first, size.second).apply {
                gravity = (iconView?.layoutParams as? FrameLayout.LayoutParams)?.gravity ?: Gravity.CENTER
            }
            host.layoutParams = layoutParams
            host.minimumWidth = size.first
            host.minimumHeight = size.second
            host.updateDesiredSize(size.first, size.second)
            hideDefaultIconView(container)
            container.addView(host)
            container.requestLayout()
            return host
        }

        private fun resolveIconSize(iconView: View?): Pair<Int, Int> {
            val width = maxOf(
                iconView?.measuredWidth ?: 0,
                iconView?.layoutParams?.width?.takeIf { it > 0 } ?: 0,
                dpToPx(24),
            )
            val height = maxOf(
                iconView?.measuredHeight ?: 0,
                iconView?.layoutParams?.height?.takeIf { it > 0 } ?: 0,
                dpToPx(24),
            )
            return width to height
        }

        private fun removeHostView(hostView: RuneTabIconHostView) {
            hostView.dispose()
            val parent = hostView.parent as? ViewGroup ?: return
            parent.removeView(hostView)
        }

        private fun hideDefaultIconView(container: ViewGroup) {
            val iconView = container.findViewById<View>(
                com.google.android.material.R.id.navigation_bar_item_icon_view,
            )
            iconView?.visibility = View.INVISIBLE
        }

        private fun restoreDefaultIconView(itemView: NavigationBarItemView) {
            val container = itemView.findViewById<ViewGroup>(
                com.google.android.material.R.id.navigation_bar_item_icon_container,
            ) ?: return
            val iconView = container.findViewById<View>(
                com.google.android.material.R.id.navigation_bar_item_icon_view,
            )
            iconView?.visibility = View.VISIBLE
            container.findViewWithTag<RuneTabIconHostView>("rune-tab-icon-host")?.let { host ->
                removeHostView(host)
            }
        }

        private fun updateNavigationColors() {
            val activeColor = resolveActiveColor()
            val inactiveColor = resolveInactiveColor()
            val states = arrayOf(
                intArrayOf(android.R.attr.state_checked),
                intArrayOf(-android.R.attr.state_checked),
            )
            val colors = intArrayOf(activeColor, inactiveColor)
            val colorStateList = ColorStateList(states, colors)
            bottomNavigationView.itemTextColor = colorStateList
            bottomNavigationView.itemIconTintList = colorStateList
        }

        private fun resolveActiveColor(): Int {
            val custom = resolveColorFromTabs { options -> options?.activeTintColor }
            return custom ?: MaterialColors.getColor(
                bottomNavigationView,
                com.google.android.material.R.attr.colorPrimary,
                Color.WHITE,
            )
        }

        private fun resolveInactiveColor(): Int {
            val custom = resolveColorFromTabs { options -> options?.inactiveTintColor }
            return custom ?: MaterialColors.getColor(
                bottomNavigationView,
                com.google.android.material.R.attr.colorOnSurfaceVariant,
                Color.GRAY,
            )
        }

        private fun resolveColorFromTabs(selector: (RouterTabOptions?) -> Int?): Int? {
            tabDefinitions.values.forEach { definition ->
                selector(definition.tabOptions)?.let { return it }
            }
            return null
        }

        private fun isRouteSelected(route: String): Boolean {
            return selectedRoute == route
        }

        private fun dpToPx(dp: Int): Int {
            val metrics = context.resources.displayMetrics
            return (dp * metrics.density).roundToInt()
        }
    }

    private fun FragmentTransaction.applyPresentationAnimation(
        options: RouterScreenOptions,
        animate: Boolean,
    ) {
        if (!animate) {
            return
        }
        if (options.presentation == RouterScreenPresentation.MODAL) {
            setReorderingAllowed(true)
            setCustomAnimations(
                R.anim.rune_slide_in_bottom,
                0,
                0,
                R.anim.rune_slide_out_bottom,
            )
            return
        }
        setTransition(FragmentTransaction.TRANSIT_FRAGMENT_OPEN)
    }
}
