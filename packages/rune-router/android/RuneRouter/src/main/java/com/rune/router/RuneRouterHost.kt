package com.rune.router

import android.app.Activity
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentManager
import com.rune.kit.runtime.RuneRuntime

object RuneRouterHost {
  private const val TAG = "RuneRouterHost"

  @JvmStatic
  fun bootstrap(activity: Activity, runtime: RuneRuntime, surfaceView: View): Boolean {
    Log.i(TAG, "Bootstrap invoked for activity=${activity::class.java.simpleName}")
    if (activity !is FragmentActivity) {
      Log.w(TAG, "Host activity must extend FragmentActivity")
      return false
    }

    // Surface view is already the activity's content view with the root node
    // Don't move it yet - let fragments attach it when they're ready
    val containerId = View.generateViewId()
    val container = FrameLayout(activity).apply {
      id = containerId
      layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
      setBackgroundColor(0xFF101014.toInt())
    }

    activity.setContentView(container)
    Log.d(TAG, "Router container set as activity content view (id=$containerId)")
    Log.i(TAG, "Surface will be moved to fragments on demand (parent=${surfaceView.parent?.javaClass?.simpleName})")

    return try {
      Log.i(TAG, "About to call RuneRouterModule.attach with surface view")
      val module = RuneRouterModule.attach(runtime, activity.supportFragmentManager, containerId, surfaceView)
      Log.i(TAG, "Module.attach returned successfully, surface view installed")
      true
    } catch (e: Exception) {
      Log.e(TAG, "Failed to attach router module", e)
      false
    }
  }
}
