package com.rune.screens

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.core.view.children
import com.google.android.material.bottomnavigation.BottomNavigationItemView
import com.google.android.material.bottomnavigation.BottomNavigationMenuView
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.navigation.NavigationBarView
import com.rune.kit.core.RuneRootView
import com.rune.kit.core.RuneUIManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Container that manages tab-based navigation with optional native BottomNavigationView.
 */
@SuppressLint("ViewConstructor")
class ScreenTabsContainerView(context: Context) : LinearLayout(context) {

    companion object {
        private const val TAG = "ScreenTabsContainer"
        private const val SURFACE_ICON_TAG_PREFIX = "rune_tab_surface_icon:"
    }

    private fun isDebugLoggingEnabled(): Boolean {
        return try {
            true
            // System.getProperty("__NATIVE_DEBUG__")?.toBoolean() ?: false
        } catch (_: Throwable) {
            false
        }
    }

    private fun idName(view: View): String {
        val id = view.id
        if (id == View.NO_ID) return "no-id"
        return try {
            view.resources.getResourceEntryName(id)
        } catch (_: Throwable) {
            id.toString()
        }
    }

    private fun dumpChildren(group: ViewGroup, depth: Int = 0, maxDepth: Int = 3): String {
        if (depth >= maxDepth) return ""
        val sb = StringBuilder()
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            sb.append("\n")
            repeat(depth) { sb.append("  ") }
            sb.append("[$i] ${child.javaClass.simpleName} id=${idName(child)} ")
            sb.append("vis=${child.visibility} ")
            sb.append("w=${child.width} h=${child.height} ")
            sb.append("lp=${child.layoutParams?.javaClass?.simpleName} ")
            sb.append("tag=${child.tag}")
            if (child is ViewGroup) {
                sb.append(dumpChildren(child, depth + 1, maxDepth))
            }
        }
        return sb.toString()
    }

    private var uiManager: RuneUIManager? = null
    private var nodeId: Int = -1
    private val contentContainer: FrameLayout
    private val bottomNav: BottomNavigationView
    
    // Props
    private var selectedIndex: Int = 0
    private var tabAnimation: ScreenAnimation = ScreenAnimation.NONE
    private var nativeTabBarEnabled: Boolean = false
    private val iconSurfaces = mutableMapOf<String, Int>() // routeKey -> surfaceId
    private var lastTabBarItemsJson: String? = null

    init {
        orientation = VERTICAL
        clipChildren = false
        clipToPadding = false
        
        // Content container takes up remaining space
        contentContainer = object : FrameLayout(context) {
             override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
                 super.addView(child, index, params)
                 // Trigger visibility update when child added
                 updateTabVisibility() 
             }
        }
        val contentParams = LayoutParams(LayoutParams.MATCH_PARENT, 0)
        contentParams.weight = 1f
        super.addView(contentContainer, contentParams)

        // Bottom Navigation
        bottomNav = BottomNavigationView(context)
        bottomNav.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
        bottomNav.clipChildren = false
        bottomNav.clipToPadding = false
        bottomNav.labelVisibilityMode = NavigationBarView.LABEL_VISIBILITY_LABELED
        bottomNav.setOnItemSelectedListener { item ->
            val index = item.itemId
            if (index != selectedIndex) {
                 // Dispatch event to JS
                 if (uiManager != null && nodeId != -1) {
                     val event = JSONObject()
                     event.put("index", index)
                     uiManager?.dispatchEvent(nodeId, "onNativeTabSelect", event)
                 }
            }
            true
        }
        // Initially hidden until enabled and items set
        bottomNav.visibility = View.GONE
        super.addView(bottomNav)
    }

    override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
        // Redirect external addView calls to contentContainer
        // Check if child is internal to avoid infinite recursion if super called it
        if (child === contentContainer || child === bottomNav) {
            super.addView(child, index, params)
        } else {
            contentContainer.addView(child, index, params)
        }
    }

    fun setUIManager(manager: RuneUIManager) {
        this.uiManager = manager
    }

    fun setNodeId(id: Int) {
        this.nodeId = id
    }

    fun setSelectedIndex(index: Int) {
        if (selectedIndex != index) {
            selectedIndex = index
            if (nativeTabBarEnabled && bottomNav.menu.size() > index) {
                bottomNav.menu.getItem(index).isChecked = true
            }
            updateTabVisibility()
            
            // Notify surface icons of update (e.g. active state change)
            notifySurfacesUpdate()
        }
    }

    fun setTabAnimationType(type: String?) {
        tabAnimation = ScreenAnimation.fromString(type)
    }

    fun setNativeTabBarEnabled(enabled: Boolean) {
        nativeTabBarEnabled = enabled
        bottomNav.visibility = if (enabled) View.VISIBLE else View.GONE
    }
    
    fun setTabBarOptions(json: String) {
        try {
            val options = JSONObject(json)
            val activeColor = parseColor(options.optString("tabBarActiveTintColor"))
            val inactiveColor = parseColor(options.optString("tabBarInactiveTintColor"))
            val backgroundColor = parseColor(options.optString("tabBarBackgroundColor"))
            
            if (backgroundColor != null) {
                bottomNav.setBackgroundColor(backgroundColor)
            }
            
            if (activeColor != null || inactiveColor != null) {
                val active = activeColor ?: Color.BLUE
                val inactive = inactiveColor ?: Color.GRAY
                val colorStateList = createColorStateList(active, inactive)
                bottomNav.itemIconTintList = colorStateList
                bottomNav.itemTextColor = colorStateList
            }

            // Always default to LABELED if not specified to avoid shifting
            val showLabels = options.optBoolean("tabBarShowLabels", true)
            bottomNav.labelVisibilityMode = if (showLabels) 
                NavigationBarView.LABEL_VISIBILITY_LABELED 
            else 
                NavigationBarView.LABEL_VISIBILITY_UNLABELED
            
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing tabBarOptions", e)
        }
    }

    fun setTabBarItems(json: String) {
        if (json == lastTabBarItemsJson) {
            return
        }
        lastTabBarItemsJson = json

        try {
            val items = JSONArray(json)
            val menu = bottomNav.menu

            // Unregister any previously-mounted icon surfaces (if any) before rebuilding.
            uiManager?.let { manager ->
                iconSurfaces.values.forEach { surfaceId ->
                    runCatching { manager.unregisterSurface(surfaceId) }
                }
            }

            menu.clear()
            iconSurfaces.clear() // TODO: reuse surfaces
            // Ensure the icon slot has a stable size even when we use a transparent placeholder drawable.
            val iconSizePx = dpToPx(24f)
            bottomNav.itemIconSize = iconSizePx

            // Defer mounting surface icons until BottomNavigation has finished building/layouting item views.
            val pendingSurfaceIcons = mutableListOf<Pair<Int, String>>() // index -> routeKey
            
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val routeKey = item.getString("key")
                val label = item.optString("label", routeKey)
                
                val menuItem = menu.add(0, i, i, label)
                
                // Handle Badge
                if (item.has("badge")) {
                    val badge = bottomNav.getOrCreateBadge(i)
                    val badgeVal = item.getString("badge")
                    try {
                        val num = badgeVal.toInt()
                        badge.number = num
                        badge.isVisible = true
                    } catch (e: NumberFormatException) {
                        badge.isVisible = true 
                    }
                    if (item.has("badgeColor")) {
                         val badgeColor = parseColor(item.getString("badgeColor"))
                         if (badgeColor != null) badge.backgroundColor = badgeColor
                    }
                } else {
                    bottomNav.removeBadge(i)
                }
                
                // Handle Icon
                val icon = item.optJSONObject("icon")
                if (icon != null) {
                    val type = icon.optString("type")
                    if (type == "surface") {
                         // Use a transparent drawable WITH intrinsic size; ColorDrawable has no intrinsic
                         // bounds and can collapse the icon container, which prevents surface layout/flush.
                         menuItem.icon = GradientDrawable().apply {
                             setColor(Color.TRANSPARENT)
                             setSize(iconSizePx, iconSizePx)
                         }
                         pendingSurfaceIcons.add(i to routeKey)
                    } else if (type == "descriptor") {
                         // Standard icon loading
                         menuItem.setIcon(android.R.drawable.ic_menu_help)
                    }
                }
            }
            
            // Re-sync selected index state
            if (menu.size() > selectedIndex) {
                menu.getItem(selectedIndex).isChecked = true
            }

            if (pendingSurfaceIcons.isNotEmpty()) {
                // Post twice: the first post lets BottomNavigationMenuView rebuild children;
                // the second ensures they are laid out with final sizes.
                bottomNav.post {
                    bottomNav.post {
                        pendingSurfaceIcons.forEach { (index, routeKey) ->
                            mountSurfaceIcon(index, routeKey)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing tabBarItems", e)
        }
    }

    @SuppressLint("RestrictedApi")
    private fun mountSurfaceIcon(index: Int, routeKey: String) {
        val manager = uiManager ?: return

        val menuView = bottomNav.getChildAt(0) as? BottomNavigationMenuView ?: return
        if (index >= menuView.childCount) return
        val itemView = menuView.getChildAt(index) as? BottomNavigationItemView ?: return

             if (isDebugLoggingEnabled()) {
                 Log.d(
                     TAG,
                     "mountSurfaceIcon(index=$index routeKey=$routeKey) bottomNav(w=${bottomNav.width} h=${bottomNav.height}) itemView(w=${itemView.width} h=${itemView.height})"
                 )
                 Log.d(TAG, "itemView children:${dumpChildren(itemView)}")
             }

             // If we've already mounted a surface wrapper for this route, reuse it.
             val existingWrapper = itemView.findViewWithTag<View>("$SURFACE_ICON_TAG_PREFIX$routeKey")
             if (existingWrapper != null) {
                 val existingSurface = (existingWrapper as? ViewGroup)
                     ?.children
                     ?.firstOrNull { it is RuneRootView } as? RuneRootView
                 if (existingSurface != null) {
                     iconSurfaces[routeKey] = existingSurface.rootId
                     val event = JSONObject()
                     event.put("surfaceId", existingSurface.rootId)
                     event.put("routeKey", routeKey)
                     event.put("active", index == selectedIndex)
                     manager.dispatchEvent(nodeId, "onNativeTabUpdate", event)
                 }
                 return
             }
             
             // Check for existing surface
             for (i in 0 until itemView.childCount) {
                 val child = itemView.getChildAt(i)
                 if (child is RuneRootView) {
                     // Already mounted, update map
                     iconSurfaces[routeKey] = child.rootId
                     
                     // Force update JS since we might have missed the initial notifySurfacesUpdate
                     // due to the map being cleared.
                     val event = JSONObject()
                     event.put("surfaceId", child.rootId)
                     event.put("routeKey", routeKey)
                     event.put("active", index == selectedIndex)
                     manager.dispatchEvent(nodeId, "onNativeTabUpdate", event)
                     
                     return
                 }
             }

             // Find the internal ImageView (which now holds the transparent drawable)
             // and its parent container to inject the surface there for correct alignment.
             var defaultIcon: ImageView? = null
             var iconContainer: ViewGroup? = null
             
             // Traverse children to find the icon view
             // BottomNavigationItemView structure:
             // - navigation_bar_item_icon_container (FrameLayout)
             //   - navigation_bar_item_active_indicator_view
             //   - navigation_bar_item_icon_view (ImageView)
             
             // Helper to find recursively if needed, but usually it's shallow
             fun findIconView(group: ViewGroup): ImageView? {
                 for (i in 0 until group.childCount) {
                     val child = group.getChildAt(i)
                     if (child is ImageView) return child
                     if (child is ViewGroup) {
                         val found = findIconView(child)
                         if (found != null) return found
                     }
                 }
                 return null
             }
             
             defaultIcon = findIconView(itemView)
             
             // Prefer Material's real icon container id when available; fallback to defaultIcon parent.
             iconContainer =
                 itemView.findViewById(com.google.android.material.R.id.navigation_bar_item_icon_container)
                     as? ViewGroup
                     ?: (defaultIcon?.parent as? ViewGroup)
             if (isDebugLoggingEnabled()) {
                 val containerLabel = iconContainer?.let { "${it.javaClass.simpleName} id=${idName(it)} w=${it.width} h=${it.height}" } ?: "null"
                 Log.d(TAG, "iconContainer resolved: $containerLabel defaultIcon=${defaultIcon?.javaClass?.simpleName} defaultIconParent=${(defaultIcon?.parent as? View)?.javaClass?.simpleName}")
                 iconContainer?.let { Log.d(TAG, "iconContainer children:${dumpChildren(it)}") }
             }

             // Create surface root
             val rootId = RuneRootView.allocateRootId()
             val surfaceView = RuneRootView(context, rootId)
             surfaceView.isClickable = false
             surfaceView.isFocusable = false
             
             val iconSizePx = dpToPx(24f)
             // Wrap surface in a fixed-size host so the RuneRootView gets a real measured size.
             val wrapper = FrameLayout(context).apply {
                 tag = "$SURFACE_ICON_TAG_PREFIX$routeKey"
                 clipChildren = false
                 clipToPadding = false
                 layoutParams = FrameLayout.LayoutParams(iconSizePx, iconSizePx).apply {
                     gravity = Gravity.CENTER
                 }
                 addView(
                     surfaceView,
                     FrameLayout.LayoutParams(
                         ViewGroup.LayoutParams.MATCH_PARENT,
                         ViewGroup.LayoutParams.MATCH_PARENT,
                     ),
                 )
             }

             // One-shot layout probes to confirm the surface gets a real size (required for surface flush).
             if (isDebugLoggingEnabled()) {
                 val wrapperListener = object : OnLayoutChangeListener {
                     override fun onLayoutChange(
                         v: View,
                         left: Int,
                         top: Int,
                         right: Int,
                         bottom: Int,
                         oldLeft: Int,
                         oldTop: Int,
                         oldRight: Int,
                         oldBottom: Int
                     ) {
                         v.removeOnLayoutChangeListener(this)
                         Log.d(TAG, "wrapper laid out routeKey=$routeKey w=${v.width} h=${v.height} x=${v.x} y=${v.y}")
                     }
                 }
                 wrapper.addOnLayoutChangeListener(wrapperListener)
                 val surfaceListener = object : OnLayoutChangeListener {
                     override fun onLayoutChange(
                         v: View,
                         left: Int,
                         top: Int,
                         right: Int,
                         bottom: Int,
                         oldLeft: Int,
                         oldTop: Int,
                         oldRight: Int,
                         oldBottom: Int
                     ) {
                         v.removeOnLayoutChangeListener(this)
                         Log.d(TAG, "surface RuneRootView laid out routeKey=$routeKey rootId=$rootId w=${v.width} h=${v.height} x=${v.x} y=${v.y}")
                     }
                 }
                 surfaceView.addOnLayoutChangeListener(surfaceListener)
             }
              
             // Add to the container if found, otherwise fallback to item view
             if (iconContainer != null) {
                 iconContainer.clipChildren = false
                 iconContainer.clipToPadding = false
                 iconContainer.minimumWidth = iconSizePx
                 iconContainer.minimumHeight = iconSizePx
                 // Insert BEHIND the default icon (which has the Badge) but ON TOP of the active indicator
                 // Hierarchy: Indicator(0) -> Surface(1) -> DefaultIcon(2)
                 // DefaultIcon is transparent but carries the Badge Overlay.
                 var insertIndex = -1
                 if (defaultIcon != null) {
                     insertIndex = iconContainer.indexOfChild(defaultIcon)
                     // Ensure default icon is visible so it (and its badge) are drawn
                     defaultIcon.visibility = View.VISIBLE
                 }
                 
                 if (insertIndex >= 0) {
                     iconContainer.addView(wrapper, insertIndex)
                 } else {
                     // Fallback: append
                     iconContainer.addView(wrapper)
                 }
                 iconContainer.requestLayout()
                 if (isDebugLoggingEnabled()) {
                     Log.d(TAG, "Inserted wrapper for routeKey=$routeKey at index=$insertIndex; iconContainer children now:${dumpChildren(iconContainer)}")
                 }
             } else {
                 // Fallback
                 (wrapper.layoutParams as? FrameLayout.LayoutParams)?.apply {
                     gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
                     topMargin = dpToPx(12f)
                 }
                 itemView.addView(wrapper)
                 if (isDebugLoggingEnabled()) {
                     Log.d(TAG, "Inserted wrapper for routeKey=$routeKey into itemView fallback; itemView children now:${dumpChildren(itemView)}")
                 }
             }
             itemView.requestLayout()
             bottomNav.requestLayout()

             // If Material doesn't immediately re-layout after dynamic insertion, force a one-shot measure/layout
             // so the surface has a non-zero size and can flush/mount its children.
             wrapper.post {
                 val wrapperW = wrapper.width
                 val wrapperH = wrapper.height
                 val surfaceW = surfaceView.width
                 val surfaceH = surfaceView.height
                 if (isDebugLoggingEnabled()) {
                     Log.d(TAG, "post-layout check routeKey=$routeKey wrapper=${wrapperW}x${wrapperH} surface=${surfaceW}x${surfaceH}")
                 }
                 if (wrapperW == 0 || wrapperH == 0 || surfaceW == 0 || surfaceH == 0) {
                     val sizeSpec = MeasureSpec.makeMeasureSpec(iconSizePx, MeasureSpec.EXACTLY)
                     runCatching {
                         wrapper.measure(sizeSpec, sizeSpec)
                         wrapper.layout(0, 0, iconSizePx, iconSizePx)
                         surfaceView.measure(sizeSpec, sizeSpec)
                         surfaceView.layout(0, 0, iconSizePx, iconSizePx)
                     }
                     if (isDebugLoggingEnabled()) {
                         Log.d(TAG, "forced measure/layout routeKey=$routeKey wrapper=${wrapper.width}x${wrapper.height} surface=${surfaceView.width}x${surfaceView.height}")
                     }
                 }
             }

             manager.registerSurface(rootId, surfaceView)
             iconSurfaces[routeKey] = rootId
             
             // Notify JS
             val event = JSONObject()
             event.put("surfaceId", rootId)
             event.put("routeKey", routeKey)
             event.put("active", index == selectedIndex)
             
             manager.dispatchEvent(nodeId, "onNativeTabMount", event)
    }
    
    private fun dpToPx(dp: Float): Int {
        return (dp * context.resources.displayMetrics.density).toInt()
    }

    private fun notifySurfacesUpdate() {
        // Post to next frame to ensure handlers are updated if they changed in the same batch
        post {
            val manager = uiManager ?: return@post
            if (nodeId == -1) {
                Log.w(TAG, "notifySurfacesUpdate: nodeId is -1, cannot dispatch event")
                return@post
            }
            
            Log.d(TAG, "notifySurfacesUpdate: surfaces=${iconSurfaces.size}")
            
            iconSurfaces.forEach { (routeKey, surfaceId) ->
                val event = JSONObject()
                event.put("surfaceId", surfaceId)
                event.put("routeKey", routeKey)
                // We let JS calculate active, but we can hint it if needed.
                manager.dispatchEvent(nodeId, "onNativeTabUpdate", event)
            }
        }
    }

    private fun updateTabVisibility() {
        // Only the child at selectedIndex should be visible
        for (i in 0 until contentContainer.childCount) {
            val child = contentContainer.getChildAt(i)
            val shouldBeVisible = (i == selectedIndex)
            
            if (shouldBeVisible) {
                if (child.visibility != View.VISIBLE) {
                    child.visibility = View.VISIBLE
                    child.translationZ = 10f
                    child.alpha = 1f
                } else {
                    if (child.translationZ != 10f) child.translationZ = 10f
                    if (child.alpha != 1f) child.alpha = 1f
                }
            } else {
                if (child.visibility != View.GONE) {
                     child.visibility = View.GONE
                     child.translationZ = 0f
                     child.alpha = 1f 
                }
            }
        }
    }

    private fun parseColor(colorString: String?): Int? {
        if (colorString.isNullOrEmpty()) return null
        return try {
            Color.parseColor(colorString)
        } catch (e: Exception) {
            null
        }
    }

    private fun createColorStateList(activeColor: Int, inactiveColor: Int): ColorStateList {
        val states = arrayOf(
            intArrayOf(android.R.attr.state_checked),
            intArrayOf(-android.R.attr.state_checked),
            intArrayOf()
        )
        val colors = intArrayOf(
            activeColor,
            inactiveColor,
            inactiveColor
        )
        return ColorStateList(states, colors)
    }
}
