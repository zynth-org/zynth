package com.zynth.screens

import android.content.Context
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout

/**
 * Container that manages a stack of Screen views.
 */
class ScreenContainerView(context: Context) : FrameLayout(context) {

  companion object {
    private const val TAG = "ScreenContainer"
  }

  internal val screens = mutableListOf<ScreenView>()
  private val detachingScreens = mutableListOf<ScreenView>()

  init {
    clipChildren = false
    clipToPadding = false
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // Preserve Yoga-driven child layouts set by the UI manager.
    for (i in 0 until childCount) {
      val child = getChildAt(i)
      child.layout(child.left, child.top, child.right, child.bottom)
    }
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
        return
      }
    }
    super.removeView(child)
    updateScreenVisibility()
  }

  override fun removeViewAt(index: Int) {
    val child = getChildAt(index)
    if (child is ScreenView) {
      if (handleDetach(child)) {
        return
      }
    }
    super.removeViewAt(index)
    updateScreenVisibility()
  }

  private fun handleDetach(screen: ScreenView): Boolean {
    val isTopScreen = screens.lastOrNull() == screen
    val shouldAnimate = isTopScreen && (screen.isScreenActive || screen.isInTransition)

    if (shouldAnimate) {
      if (!detachingScreens.contains(screen)) {
        Log.d(TAG, "Deferring removal of ${screen.screenKey} for exit animation")

        screens.remove(screen)
        detachingScreens.add(screen)

        updateScreenVisibility()
        screen.startExitAnimationAndCleanup()
      }
      return true
    }

    screens.remove(screen)
    detachingScreens.remove(screen)
    screen.container = null
    return false
  }

  fun finishRemoval(screen: ScreenView) {
    Log.d(TAG, "Finishing removal of ${screen.screenKey}")
    detachingScreens.remove(screen)
    screen.container = null
    post { super.removeView(screen) }
  }

  internal fun updateScreenVisibility() {
    val activeScreens = screens.filter { it.isScreenActive }
    val topActive = activeScreens.lastOrNull()
    val modalBackgroundIndex = if (topActive?.animation == ScreenAnimation.MODAL) {
      screens.indexOf(topActive) - 1
    } else {
      -1
    }

    for ((index, screen) in screens.withIndex()) {
      var shouldBeVisible = false

      if (screen == topActive) shouldBeVisible = true
      if (screen.isInTransition) shouldBeVisible = true
      if (index + 1 < screens.size) {
        val screenAbove = screens[index + 1]
        if (screenAbove.isInTransition) {
          shouldBeVisible = true
        }
      }
      if (index == modalBackgroundIndex) {
        shouldBeVisible = true
      }
      if (detachingScreens.isNotEmpty() && screen == topActive) {
        shouldBeVisible = true
      }

            if (shouldBeVisible) {
                if (!screen.isInTransition) {
                    screen.ensureVisibleState()
                } else {
                    screen.visibility = View.VISIBLE
                }
            } else {
                screen.visibility = View.GONE
            }
      screen.translationZ = index.toFloat()
    }

    for ((index, screen) in detachingScreens.withIndex()) {
      screen.visibility = View.VISIBLE
      screen.translationZ = (screens.size + index + 100).toFloat()
    }
  }

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
