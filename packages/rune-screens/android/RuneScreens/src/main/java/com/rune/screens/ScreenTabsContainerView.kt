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

    /** Currently selected tab index */
    private var selectedIndex: Int = 0

    /** Animation type for tab switching */
    var tabAnimation: ScreenAnimation = ScreenAnimation.NONE
        private set

    init {
        clipChildren = false
        clipToPadding = false
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // Enforce visibility before measuring to ensure only the selected tab is measured/laid out
        updateTabVisibility()
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        // Enforce visibility again after layout to catch any mid-layout changes
        updateTabVisibility()
    }

    override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
        super.addView(child, index, params)
        // Ensure the newly added child is correctly sized
        child?.layoutParams = LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        
        // When a view is added, we must update visibility to ensure it respects the current selection
        updateTabVisibility()
    }

    /**
     * Set the selected tab index
     */
    fun setSelectedIndex(index: Int) {
        val previousIndex = selectedIndex
        selectedIndex = index
        
        if (childCount > 0) {
             updateTabVisibility()
        }
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
        // Iterate through all children to ensure correct state
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            val shouldBeVisible = (i == selectedIndex)
            
            if (shouldBeVisible) {
                // If we are showing the view (switching from GONE/INVISIBLE to VISIBLE)
                if (child.visibility != View.VISIBLE) {
                    // 1. Prepare for display
                    child.visibility = View.VISIBLE
                    child.translationZ = 10f
                    child.alpha = 1f
                } else {
                    // Already visible, ensure properties are correct (e.g. if re-added)
                    if (child.translationZ != 10f) child.translationZ = 10f
                    if (child.alpha != 1f) child.alpha = 1f
                }
            } else {
                // Hiding the view
                if (child.visibility != View.GONE) {
                     child.visibility = View.GONE
                     child.translationZ = 0f
                     child.alpha = 1f // Reset alpha for next time
                }
            }
            
            // Manage activity state if it's a ScreenView
            if (child is ScreenView) {
                // Future: wiring for onAppear/onDisappear events
            }
        }
    }
}
