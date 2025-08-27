package com.rune.screens

import android.content.Context
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout

/**
 * Container that manages tab-based navigation.
 * 
 * Each direct child is treated as a tab's content. Only one tab
 * is visible at a time. Switching tabs can optionally animate.
 * 
 * This is for managing the content area of tabs - the tab bar itself
 * should be rendered via JS using your style engine.
 */
class ScreenTabsContainerView(context: Context) : FrameLayout(context) {

    companion object {
        private const val TAG = "ScreenTabsContainer"
    }

    /**
     * We reuse ScreenContainerView logic for ScreenView lifecycle/animations
     * without adding it to the hierarchy. This keeps the ScreenView `container`
     * pointer non-null so active state changes apply immediately.
     */
    private val containerProxy = ScreenContainerView(context)

    /** Currently selected tab index */
    private var selectedIndex: Int = 0

    /** All tab content views */
    private val tabs = mutableListOf<View>()

    /** Animation type for tab switching */
    var tabAnimation: ScreenAnimation = ScreenAnimation.NONE
        private set

    init {
        clipChildren = false
        clipToPadding = false
    }

    override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
        if (child != null) {
            tabs.add(child)
            Log.d(TAG, "Added tab at index ${tabs.size - 1}")

            if (child is ScreenView) {
                // Keep ScreenView lifecycle consistent with the stack container
                containerProxy.screens.add(child)
                child.container = containerProxy
            }
        }
        super.addView(child, index, params)
        updateTabVisibility()
    }

    override fun removeView(child: View?) {
        if (child != null) {
            tabs.remove(child)

            if (child is ScreenView) {
                containerProxy.screens.remove(child)
                child.container = null
            }
        }
        super.removeView(child)
        updateTabVisibility()
    }

    override fun removeViewAt(index: Int) {
        val child = getChildAt(index)
        if (child != null) {
            tabs.remove(child)

            if (child is ScreenView) {
                containerProxy.screens.remove(child)
                child.container = null
            }
        }
        super.removeViewAt(index)
        updateTabVisibility()
    }

    /**
     * Set the selected tab index
     */
    fun setSelectedIndex(index: Int) {
        if (index < 0 || index >= tabs.size) {
            Log.w(TAG, "Invalid tab index: $index (have ${tabs.size} tabs)")
            return
        }
        
        if (selectedIndex == index) return
        
        Log.d(TAG, "Switching tab: $selectedIndex -> $index")
        
        val previousIndex = selectedIndex
        selectedIndex = index
        
        animateTabSwitch(previousIndex, index)
    }

    /**
     * Set the animation type for tab switching
     */
    fun setTabAnimationType(type: String?) {
        tabAnimation = ScreenAnimation.fromString(type)
    }

    /**
     * Update tab visibility (only selected tab is visible)
     */
    private fun updateTabVisibility() {
        tabs.forEachIndexed { index, tab ->
            tab.visibility = if (index == selectedIndex) View.VISIBLE else View.GONE
        }
    }

    /**
     * Animate switching between tabs
     */
    private fun animateTabSwitch(fromIndex: Int, toIndex: Int) {
        if (tabAnimation == ScreenAnimation.NONE) {
            // No animation - just update visibility
            updateTabVisibility()
            return
        }
        
        val fromTab = tabs.getOrNull(fromIndex)
        val toTab = tabs.getOrNull(toIndex)
        
        if (fromTab == null || toTab == null) {
            updateTabVisibility()
            return
        }
        
        // For now, just cross-fade between tabs
        // Phase 2 can add more sophisticated animations
        toTab.visibility = View.VISIBLE
        toTab.alpha = 0f
        
        toTab.animate()
            .alpha(1f)
            .setDuration(200)
            .start()
        
        fromTab.animate()
            .alpha(0f)
            .setDuration(200)
            .withEndAction {
                fromTab.visibility = View.GONE
                fromTab.alpha = 1f
            }
            .start()
    }

    /**
     * Get the currently selected tab index
     */
    fun getSelectedIndex(): Int = selectedIndex

    /**
     * Get the total number of tabs
     */
    fun getTabCount(): Int = tabs.size
}
