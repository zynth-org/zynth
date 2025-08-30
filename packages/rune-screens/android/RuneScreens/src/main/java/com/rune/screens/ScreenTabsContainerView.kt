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
        // Iterate through all children to ensure correct state
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            val shouldBeVisible = (i == selectedIndex)
            
            if (shouldBeVisible) {
                // If we are showing the view (switching from GONE/INVISIBLE to VISIBLE)
                if (child.visibility != View.VISIBLE) {
                    Log.d(TAG, "Showing child $i (alpha fade-in)")
                    
                    // 1. Prepare for display
                    child.visibility = View.VISIBLE
                    child.translationZ = 10f
                    
                    // 2. Prevent FOUC: Start transparent
                    child.alpha = 0f
                    
                    // 3. Fade in after layout has likely occurred
                    child.post {
                        // Check if still valid to show
                        if (indexOfChild(child) == selectedIndex) {
                             child.animate()
                                 .alpha(1f)
                                 .setDuration(100) // Short fade to mask unstyled frame
                                 .start()
                        }
                    }
                } else {
                    // Already visible, ensure properties are correct (e.g. if re-added)
                    if (child.translationZ != 10f) child.translationZ = 10f
                    if (child.alpha != 1f) child.alpha = 1f
                }
            } else {
                // Hiding the view
                if (child.visibility != View.GONE) {
                     Log.d(TAG, "Hiding child $i")
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
        
        requestLayout()
        invalidate()
    }
}
