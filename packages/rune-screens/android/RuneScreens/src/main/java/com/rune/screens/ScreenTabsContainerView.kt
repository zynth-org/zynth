package com.rune.screens

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
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
            menu.clear()
            iconSurfaces.clear() // TODO: reuse surfaces
            
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
                         // Native Surface Icon
                         mountSurfaceIcon(i, routeKey)
                         // Use transparent icon to reserve space and tracking
                         menuItem.icon = ColorDrawable(Color.TRANSPARENT)
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
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing tabBarItems", e)
        }
    }

    @SuppressLint("RestrictedApi")
    private fun mountSurfaceIcon(index: Int, routeKey: String) {
        val manager = uiManager ?: return
        
        // Post to ensure layout is ready
        bottomNav.post { 
             val menuView = bottomNav.getChildAt(0) as? BottomNavigationMenuView ?: return@post
             if (index >= menuView.childCount) return@post
             val itemView = menuView.getChildAt(index) as? BottomNavigationItemView ?: return@post
             
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
                     
                     return@post
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
             
             if (defaultIcon != null) {
                 iconContainer = defaultIcon.parent as? ViewGroup
             }

             // Create surface root
             val rootId = RuneRootView.allocateRootId()
             val surfaceView = RuneRootView(context, rootId)
             surfaceView.isClickable = false
             surfaceView.isFocusable = false
             
             val iconSizePx = dpToPx(24f)
             // Force FrameLayout.LayoutParams with default gravity (TOP|START)
             // We will manually position it to center, preventing layout conflicts
             val params = FrameLayout.LayoutParams(iconSizePx, iconSizePx)
             surfaceView.layoutParams = params
             
             // Add to the container if found, otherwise fallback to item view
             if (iconContainer != null) {
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
                     iconContainer.addView(surfaceView, insertIndex)
                 } else {
                     // Fallback: append
                     iconContainer.addView(surfaceView)
                 }
                 
                 // Brute-force centering: manual layout listener
                 iconContainer.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                     val w = right - left
                     val h = bottom - top
                     
                     // Post to ensure this runs AFTER the layout pass has settled child positions
                     iconContainer.post {
                         // Force measure if needed (safety check)
                         if (surfaceView.width != iconSizePx || surfaceView.height != iconSizePx) {
                             surfaceView.measure(
                                 MeasureSpec.makeMeasureSpec(iconSizePx, MeasureSpec.EXACTLY),
                                 MeasureSpec.makeMeasureSpec(iconSizePx, MeasureSpec.EXACTLY)
                             )
                             surfaceView.layout(0, 0, iconSizePx, iconSizePx)
                         }
                         
                         if (w > 0 && h > 0) {
                             // Place at center relative to container
                             surfaceView.x = (w - iconSizePx) / 2f
                             surfaceView.y = (h - iconSizePx) / 2f
                         }
                     }
                 }
                 // Trigger initial layout calculation
                 iconContainer.post {
                     iconContainer.requestLayout()
                 }
             } else {
                 // Fallback
                 params.gravity = Gravity.CENTER_HORIZONTAL or Gravity.TOP
                 params.topMargin = dpToPx(12f)
                 itemView.addView(surfaceView)
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
