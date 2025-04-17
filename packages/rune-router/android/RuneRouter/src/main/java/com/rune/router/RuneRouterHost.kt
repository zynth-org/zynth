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
    Log.i(TAG, "=".repeat(60))
    Log.i(TAG, "ROUTER BOOTSTRAP START")
    Log.i(TAG, "Activity: ${activity::class.java.simpleName}")
    Log.i(TAG, "SurfaceView: ${surfaceView.javaClass.simpleName}")
    Log.i(TAG, "SurfaceView parent: ${surfaceView.parent?.javaClass?.simpleName ?: "null"}")
    Log.i(TAG, "SurfaceView attached to window: ${surfaceView.isAttachedToWindow}")
    
    if (activity !is FragmentActivity) {
      Log.w(TAG, "Host activity must extend FragmentActivity")
      return false
    }

    val containerId = View.generateViewId()
    val container = FrameLayout(activity).apply {
      id = containerId
      layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
      setBackgroundColor(0xFF101014.toInt())
    }
    
    Log.i(TAG, "Created container with id=$containerId")

    activity.setContentView(container)
    Log.i(TAG, "Set container as content view")
    Log.i(TAG, "SurfaceView parent after setContentView: ${surfaceView.parent?.javaClass?.simpleName ?: "null"}")

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
