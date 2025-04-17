package com.rune.router

import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.fragment.app.Fragment
import org.json.JSONObject
import java.util.UUID

private const val HOST_TAG = "RuneScreenHost"

internal class ScreenHostFragment : Fragment() {
  lateinit var routeKey: String
    private set
  private lateinit var routeName: String
  private var params: HashMap<String, Any?>? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    routeKey = requireArguments().getString(ARG_KEY) ?: UUID.randomUUID().toString()
    routeName = requireArguments().getString(ARG_ROUTE) ?: ""
    @Suppress("UNCHECKED_CAST")
    params = requireArguments().getSerializable(ARG_PARAMS) as? HashMap<String, Any?>
    Log.d(HOST_TAG, "onCreate route=$routeName key=$routeKey params=${params?.keys}")
  }

  override fun onCreateView(
    inflater: LayoutInflater,
    container: ViewGroup?,
    savedInstanceState: Bundle?
  ): View {
    Log.d(HOST_TAG, "onCreateView for $routeKey")
    return FrameLayout(requireContext()).apply {
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      // setBackgroundColor(0xFF101014.toInt()) // <-- REMOVE THIS LINE
    }
  }

  override fun onResume() {
    super.onResume()
    Log.d(HOST_TAG, "onResume route=$routeKey, view=${view?.javaClass?.simpleName ?: "NULL"}")
    RouterControllerRegistry.resolve(routeKey)?.onFragmentShown(this)
  }
  
  override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
    super.onViewCreated(view, savedInstanceState)
    Log.d(HOST_TAG, "onViewCreated route=$routeKey")
  }

  fun updateParams(newParams: JSONObject) {
    params = HashMap<String, Any?>(newParams.length()).apply {
      newParams.keys().forEach { k -> put(k, newParams.opt(k)) }
    }
    Log.d(HOST_TAG, "updateParams route=$routeKey size=${newParams.length()}")
  }

  fun attachSurfaceView(view: View) {
    android.util.Log.e("SURFACE_ATTACH", ">>> attachSurfaceView CALLED for route=$routeKey")
    val container = this.view as? ViewGroup
    if (container == null) {
      android.util.Log.e("SURFACE_ATTACH", "!!! attachSurfaceView: fragment view is NULL for route=$routeKey")
      return
    }
    
    android.util.Log.e("SURFACE_ATTACH", "attachSurfaceView route=$routeKey")
    android.util.Log.e("SURFACE_ATTACH", "  - Surface parent: ${view.parent?.javaClass?.simpleName}")
    android.util.Log.e("SURFACE_ATTACH", "  - Container: ${container.javaClass.simpleName}")
    android.util.Log.e("SURFACE_ATTACH", "  - Container childCount: ${container.childCount}")
    android.util.Log.e("SURFACE_ATTACH", "  - Container attached to window: ${container.isAttachedToWindow}")
    android.util.Log.e("SURFACE_ATTACH", "  - View attached to window BEFORE: ${view.isAttachedToWindow}")
    
    if (view.parent !== container) {
      android.util.Log.e("SURFACE_ATTACH", "  - Removing from parent: ${view.parent?.javaClass?.simpleName}")
      (view.parent as? ViewGroup)?.removeView(view)
      
      android.util.Log.e("SURFACE_ATTACH", "  - Clearing container (had ${container.childCount} children)")
      container.removeAllViews()
      
      android.util.Log.e("SURFACE_ATTACH", "  - Adding surface to container")
      container.addView(
        view,
        ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      )
      android.util.Log.e("SURFACE_ATTACH", "!!! Surface SUCCESSFULLY attached to fragment $routeKey")
      android.util.Log.e("SURFACE_ATTACH", "  - Container now has ${container.childCount} children")
      android.util.Log.e("SURFACE_ATTACH", "  - View attached to window AFTER: ${view.isAttachedToWindow}")
      
      // Force a complete layout pass on the view hierarchy
      container.post {
        android.util.Log.e("SURFACE_ATTACH", "  - Posted runnable executing")
        view.requestLayout()
        view.invalidate()
        container.requestLayout()
        container.invalidate()
        android.util.Log.e("SURFACE_ATTACH", "  - Forced layout/invalidate on next frame")
      }
    } else {
      android.util.Log.e("SURFACE_ATTACH", "Surface already attached to fragment $routeKey")
    }
  }

  fun applyOptions(options: JSONObject) {
    Log.d(HOST_TAG, "applyOptions route=$routeKey keys=${options.names()?.length() ?: 0}")
    if (options.has("title")) {
      activity?.title = options.optString("title")
    }
  }

  companion object {
    private const val ARG_KEY = "key"
    private const val ARG_ROUTE = "route"
    private const val ARG_PARAMS = "params"

    fun newInstance(key: String, name: String, params: JSONObject?): ScreenHostFragment {
      val fragment = ScreenHostFragment()
      fragment.arguments = Bundle().apply {
        putString(ARG_KEY, key)
        putString(ARG_ROUTE, name)
        if (params != null) {
          val map = HashMap<String, Any?>(params.length())
          params.keys().forEach { entry ->
            map[entry] = params.opt(entry)
          }
          putSerializable(ARG_PARAMS, map)
        }
      }
      return fragment
    }
  }
}
