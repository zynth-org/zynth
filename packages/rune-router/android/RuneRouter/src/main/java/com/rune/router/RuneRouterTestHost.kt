package com.rune.router

import android.app.Activity
import android.util.Log
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.commit
import com.rune.kit.runtime.RuneRuntime

/**
 * Minimal test host that bypasses the full router complexity.
 * Use this to verify basic fragment + surface view mechanics work.
 */
object RuneRouterTestHost {
  private const val TAG = "RuneRouterTestHost"
  
  @JvmStatic
  fun bootstrapMinimalTest(activity: Activity, runtime: RuneRuntime, surfaceView: View): Boolean {
    Log.i(TAG, "=== MINIMAL TEST BOOTSTRAP ===")
    
    if (activity !is FragmentActivity) {
      Log.w(TAG, "Activity must extend FragmentActivity")
      return false
    }
    
    // Create container
    val containerId = View.generateViewId()
    val container = FrameLayout(activity).apply {
      id = containerId
      layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
      setBackgroundColor(0xFFFF0000.toInt()) // Bright red background to debug
    }
    
    Log.i(TAG, "Setting container as content view (id=$containerId)")
    activity.setContentView(container)
    
    // Create minimal test fragment
    val fragment = TestMinimalFragment.newInstance()
    
    Log.i(TAG, "Committing fragment transaction")
    activity.supportFragmentManager.commit {
      setReorderingAllowed(true)
      replace(containerId, fragment, "test-fragment")
    }
    
    // Execute immediately
    activity.supportFragmentManager.executePendingTransactions()
    Log.i(TAG, "Fragment transactions executed")
    
    // Attach surface to fragment
    Log.i(TAG, "Attaching surface view to fragment")
    fragment.attachSurface(surfaceView)
    
    Log.i(TAG, "=== MINIMAL TEST COMPLETE ===")
    return true
  }
}
