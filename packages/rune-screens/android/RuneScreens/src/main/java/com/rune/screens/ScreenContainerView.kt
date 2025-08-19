package com.rune.screens

import android.content.Context
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout

/**
 * Container that manages a stack of Screen views.
 * 
 * Handles z-ordering and visibility of child screens. Only the topmost
 * active screen is visible; others are hidden but kept in the view hierarchy
 * for fast transitions.
 */
class ScreenContainerView(context: Context) : FrameLayout(context) {

    companion object {
        private const val TAG = "ScreenContainer"
    }

    // Main stack of screens
    internal val screens = mutableListOf<ScreenView>()
    
    // Screens that are animating out before being removed
    private val detachingScreens = mutableListOf<ScreenView>()

    init {
        // Don't clip children during animations
        clipChildren = false
        clipToPadding = false
    }

    override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
        if (child is ScreenView) {
            screens.add(child)
            child.container = this
            Log.d(TAG, "Added screen: ${child.screenKey}, total screens: ${screens.size}")
        }
        super.addView(child, index, params)
        updateScreenVisibility()
    }

    override fun removeView(child: View?) {
        if (child is ScreenView) {
            if (handleDetach(child)) {
                return // Removal deferred
            }
        }
        super.removeView(child)
        updateScreenVisibility()
    }

    override fun removeViewAt(index: Int) {
        val child = getChildAt(index)
        if (child is ScreenView) {
            if (handleDetach(child)) {
                return // Removal deferred
            }
        }
        super.removeViewAt(index)
        updateScreenVisibility()
    }

    private fun handleDetach(screen: ScreenView): Boolean {
        // If the screen is visible or active, animate it out first
        if (screen.visibility == View.VISIBLE || screen.isScreenActive) {
            if (!detachingScreens.contains(screen)) {
                Log.d(TAG, "Deferring removal of ${screen.screenKey} for exit animation")
                
                // Move from main list to detaching list
                screens.remove(screen)
                detachingScreens.add(screen)
                
                // Trigger exit animation
                // Note: The screen is no longer in 'screens', so updateScreenVisibility 
                // will treat the next screen down as the new top.
                updateScreenVisibility()
                
                // Start animation which will call finishRemoval when done
                screen.startExitAnimationAndCleanup()
                
                return true
            }
        }
        
        // Just cleanup references
        screens.remove(screen)
        detachingScreens.remove(screen)
        screen.container = null
        return false
    }

    /**
     * Called by ScreenView when exit animation is done
     */
    fun finishRemoval(screen: ScreenView) {
        Log.d(TAG, "Finishing removal of ${screen.screenKey}")
        detachingScreens.remove(screen)
        screen.container = null
        
        // Perform actual removal from ViewGroup
        post {
            super.removeView(screen)
        }
    }

    /**
     * Updates the visibility and z-order of all screens.
     */
    internal fun updateScreenVisibility() {
        val activeScreens = screens.filter { it.isScreenActive }
        val topActive = activeScreens.lastOrNull()
        val modalBackgroundIndex = if (topActive?.animation == ScreenAnimation.MODAL) {
            screens.indexOf(topActive) - 1
        } else {
            -1
        }
        
        // 1. Handle normal screens in the stack
        for ((index, screen) in screens.withIndex()) {
            var shouldBeVisible = false
            
            // Top active screen is always visible
            if (screen == topActive) shouldBeVisible = true
            
            // If the screen is transitioning, it's visible
            if (screen.isInTransition) shouldBeVisible = true
            
            // If the screen ABOVE this one is transitioning, this one might need to be visible 
            // as the background (cross-fade target).
            if (index + 1 < screens.size) {
                val screenAbove = screens[index + 1]
                if (screenAbove.isInTransition) {
                    shouldBeVisible = true
                }
            }

            // Keep the immediate screen below a modal visible as the backdrop.
            if (index == modalBackgroundIndex) {
                shouldBeVisible = true
            }
            
            // Also, if there are any DETACHING screens (popping), the top active screen 
            // (which is below them) must be visible to be revealed.
            if (detachingScreens.isNotEmpty() && screen == topActive) {
                shouldBeVisible = true
            }

            screen.visibility = if (shouldBeVisible) View.VISIBLE else View.GONE
            
            // Normal stack z-order
            screen.translationZ = index.toFloat()
        }
        
        // 2. Handle detaching screens (they float on top)
        for ((index, screen) in detachingScreens.withIndex()) {
            screen.visibility = View.VISIBLE
            // Ensure they are above everything else in the normal stack
            screen.translationZ = (screens.size + index + 100).toFloat()
        }
    }

    /**
     * Find a screen by its key
     */
    fun findScreenByKey(key: String): ScreenView? {
        return screens.find { it.screenKey == key } ?: detachingScreens.find { it.screenKey == key }
    }

    fun getTopScreen(): ScreenView? {
        return screens.lastOrNull { it.isScreenActive }
    }

    fun getActiveScreens(): List<ScreenView> {
        return screens.filter { it.isScreenActive }
    }
}
