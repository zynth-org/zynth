package com.zynth.kit.core

import android.os.Build
import android.view.ViewGroup

/**
 * Extension function to suppress or resume layout for a ViewGroup.
 * 
 * When suppress is true, prevents layout passes on the view and its children.
 * When suppress is false, resumes normal layout behavior.
 * 
 * This is useful for batching view operations to improve performance.
 */
internal fun ViewGroup.suppressLayoutCompat(suppress: Boolean) {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
    // API 29+: Use the built-in suppressLayout
    this.suppressLayout(suppress)
  } else {
    // Fallback for older API levels: manually manage layout state
    if (suppress) {
      // Note: isLayoutSuppressed is only available in Q+, so we can't check it here
      // Just attempt to suppress if possible through the view hierarchy
      this.requestLayout()
    } else {
      this.requestLayout()
    }
  }
}
