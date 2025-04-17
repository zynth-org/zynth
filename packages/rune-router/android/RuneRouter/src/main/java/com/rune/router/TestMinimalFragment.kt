package com.rune.router

import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.fragment.app.Fragment

/**
 * Ultra-minimal test fragment to verify basic fragment + surface view attachment works.
 * Use this to test the native side without the full router complexity.
 */
class TestMinimalFragment : Fragment() {
  
  private var testSurfaceView: View? = null
  
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Log.i(TAG, "TestMinimalFragment onCreate")
  }
  
  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?
  ): View {
    Log.i(TAG, "TestMinimalFragment onCreateView")
    return FrameLayout(requireContext()).apply {
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      setBackgroundColor(0xFF00FF00.toInt()) // Bright green to make it obvious
    }
  }
  
  override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
    super.onViewCreated(view, savedInstanceState)
    Log.i(TAG, "TestMinimalFragment onViewCreated")
    
    // If we have a test surface, attach it now
    testSurfaceView?.let { surface ->
      attachSurface(surface)
    }
  }
  
  override fun onResume() {
    super.onResume()
    Log.i(TAG, "TestMinimalFragment onResume")
  }
  
  fun attachSurface(surfaceView: View) {
    val container = this.view as? ViewGroup
    if (container == null) {
      Log.w(TAG, "attachSurface called but fragment view is null")
      testSurfaceView = surfaceView
      return
    }
    
    Log.i(TAG, "attachSurface - parent=${surfaceView.parent?.javaClass?.simpleName}")
    
    // Remove from previous parent
    (surfaceView.parent as? ViewGroup)?.removeView(surfaceView)
    
    // Clear container and add surface
    container.removeAllViews()
    container.addView(
      surfaceView,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    
    Log.i(TAG, "Surface attached successfully")
  }
  
  companion object {
    private const val TAG = "TestMinimalFragment"
    
    fun newInstance(): TestMinimalFragment {
      return TestMinimalFragment()
    }
  }
}
