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

    override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
        super.addView(child, index, params)
        // Ensure the newly added child is correctly sized
        child?.layoutParams = LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        
        Log.d(TAG, "addView: index=$index, total children=$childCount")
        
        // When a view is added, we must update visibility to ensure it respects the current selection
        updateTabVisibility()
    }

    override fun removeView(child: View?) {
        super.removeView(child)
        updateTabVisibility()
    }

    override fun removeViewAt(index: Int) {
        super.removeViewAt(index)
        updateTabVisibility()
    }

    /**
     * Set the selected tab index
     */
    fun setSelectedIndex(index: Int) {
        Log.d(TAG, "setSelectedIndex: $selectedIndex -> $index (children=$childCount)")
        
        val previousIndex = selectedIndex
        selectedIndex = index
        
        if (childCount > 0) {
            if (previousIndex != index) {
                // Future: Implement transition animations here
                updateTabVisibility()
            } else {
                updateTabVisibility()
            }
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
        Log.d(TAG, "updateTabVisibility: selectedIndex=$selectedIndex, children=$childCount")
        
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            val shouldBeVisible = (i == selectedIndex)
            
            // Manage visibility
            val desiredVisibility = if (shouldBeVisible) View.VISIBLE else View.GONE
            if (child.visibility != desiredVisibility) {
                child.visibility = desiredVisibility
                Log.d(TAG, "Child $i visibility -> $desiredVisibility")
            }
            
            // Manage activity state if it's a ScreenView
            if (child is ScreenView) {
                // Manually notify ScreenView of its active state since we aren't using the container stack logic
                // We use reflection or access internal/public methods if available. 
                // Since ScreenView logic depends on 'container', and we don't set it, we might skip this.
                // However, for correct eventing (onAppear), we might need to handle this in the future.
                // For now, visibility is the primary concern.
            }

            // Ensure the active tab is at the top of the Z-order using translationZ
            // DO NOT use bringToFront() as it reorders the children and breaks index correspondence
            child.translationZ = if (shouldBeVisible) 10f else 0f
        }
        
        // Force a layout request to ensure changes apply
        requestLayout()
        invalidate()
    }
}
