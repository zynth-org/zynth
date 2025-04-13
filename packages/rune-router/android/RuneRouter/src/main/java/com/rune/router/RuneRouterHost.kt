package com.rune.router

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.FrameLayout
import android.util.Log
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentManager
import com.rune.kit.runtime.RuneRuntime

object RuneRouterHost {
  @JvmStatic
  fun bootstrap(activity: Activity, runtime: RuneRuntime, surfaceView: View): Boolean {
    if (activity !is FragmentActivity) {
      Log.w("RuneRouterHost", "Host activity must extend FragmentActivity")
      return false
    }

    val containerId = View.generateViewId()
    val container = FrameLayout(activity).apply {
      id = containerId
      layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
      setBackgroundColor(0xFF101014.toInt())
    }

    // Remove surface view from any previous parent; keep it visible until first fragment shows
    (surfaceView.parent as? ViewGroup)?.removeView(surfaceView)
    container.addView(
      surfaceView,
      FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
    )

    activity.setContentView(container)

    val module = RuneRouterModule.attach(runtime, activity.supportFragmentManager, containerId)
    module.installSurfaceView(surfaceView)
    Log.i("RuneRouterHost", "RuneRouter attached to FragmentActivity container")
    return true
  }
}
