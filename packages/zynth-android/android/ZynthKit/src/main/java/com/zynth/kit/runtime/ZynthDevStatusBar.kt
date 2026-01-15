package com.zynth.kit.runtime

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * Visual indicator for HMR bundle loading and updates
 */
class ZynthDevStatusBar(private val host: ViewGroup) : FrameLayout(host.context) {
  private val textView: TextView
  private val progressBar: ProgressBar
  private val handler = Handler(Looper.getMainLooper())
  private var hideRunnable: Runnable? = null

  init {
    // Container styling
    layoutParams = LayoutParams(
      LayoutParams.MATCH_PARENT,
      dpToPx(32)
    )
    setBackgroundColor(Color.parseColor("#007AFF")) // iOS blue
    alpha = 0f
    elevation = Float.MAX_VALUE

    // TextView setup
    textView = TextView(context).apply {
      textSize = 12f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      layoutParams = LayoutParams(
        LayoutParams.WRAP_CONTENT,
        LayoutParams.MATCH_PARENT
      ).apply {
        gravity = Gravity.CENTER
      }
    }
    addView(textView)

    // ProgressBar setup
    progressBar = ProgressBar(context, null, android.R.attr.progressBarStyleSmall).apply {
      layoutParams = LayoutParams(
        dpToPx(20),
        dpToPx(20)
      ).apply {
        gravity = Gravity.CENTER
        marginEnd = dpToPx(8)
      }
      visibility = View.GONE
    }
    addView(progressBar, 0) // Add before textView
  }

  /**
   * Show "Bundle Loading..." indicator at bottom
   */
  fun showBundleLoading() {
    cancelHideTimer()
    setBackgroundColor(Color.parseColor("#FF9500")) // iOS orange
    textView.text = "Loading Bundle..."
    progressBar.visibility = View.VISIBLE
    animateIn(Position.BOTTOM)
  }

  /**
   * Show "Bundle Loaded" success message at bottom
   */
  fun showBundleLoaded() {
    cancelHideTimer()
    setBackgroundColor(Color.parseColor("#34C759")) // iOS green
    textView.text = "Bundle Loaded"
    progressBar.visibility = View.GONE
    animateIn(Position.BOTTOM)

    // Auto-hide after 2 seconds
    hideRunnable = Runnable { hide() }
    handler.postDelayed(hideRunnable!!, 2000)
  }

  /**
   * Show "Update Available" notification at top
   */
  fun showUpdateAvailable() {
    cancelHideTimer()
    setBackgroundColor(Color.parseColor("#007AFF")) // iOS blue
    textView.text = "Update Available"
    progressBar.visibility = View.GONE
    animateIn(Position.TOP)

    // Auto-hide after 1.5 seconds
    hideRunnable = Runnable { hide() }
    handler.postDelayed(hideRunnable!!, 1500)
  }

  /**
   * Show "Updating..." indicator at top
   */
  fun showUpdating() {
    cancelHideTimer()
    setBackgroundColor(Color.parseColor("#007AFF")) // iOS blue
    textView.text = "Updating..."
    progressBar.visibility = View.VISIBLE
    animateIn(Position.TOP)
  }

  /**
   * Show error message at bottom
   */
  fun showError(message: String) {
    cancelHideTimer()
    setBackgroundColor(Color.parseColor("#FF3B30")) // iOS red
    textView.text = message
    progressBar.visibility = View.GONE
    animateIn(Position.BOTTOM)

    // Auto-hide after 4 seconds
    hideRunnable = Runnable { hide() }
    handler.postDelayed(hideRunnable!!, 4000)
  }

  /**
   * Hide the status bar
   */
  fun hide() {
    cancelHideTimer()
    animate()
      .alpha(0f)
      .setDuration(300)
      .setListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          visibility = View.GONE
        }
      })
      .start()
  }

  private fun cancelHideTimer() {
    hideRunnable?.let {
      handler.removeCallbacks(it)
      hideRunnable = null
    }
  }

  private fun animateIn(position: Position) {
    // Ensure we're attached to the root view
    if (parent == null) {
      host.addView(this)
    }

    // Position at top or bottom
    val params = layoutParams as? FrameLayout.LayoutParams ?: return
    params.gravity = when (position) {
      Position.TOP -> Gravity.TOP or Gravity.CENTER_HORIZONTAL
      Position.BOTTOM -> Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
    }
    layoutParams = params

    // Keep overlay above app content every time it animates in
    bringToFront()

    // Animate in
    visibility = View.VISIBLE
    alpha = 0f
    animate()
      .alpha(1f)
      .setDuration(300)
      .setListener(null)
      .start()
  }

  private fun dpToPx(dp: Int): Int {
    return (dp * resources.displayMetrics.density).toInt()
  }

  private enum class Position {
    TOP,
    BOTTOM
  }
}
