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
      setBackgroundColor(0xFF101014.toInt())
    }
  }

  override fun onResume() {
    super.onResume()
    Log.d(HOST_TAG, "onResume route=$routeKey")
    RouterControllerRegistry.resolve(routeKey)?.onFragmentShown(this)
  }

  fun updateParams(newParams: JSONObject) {
    params = HashMap<String, Any?>(newParams.length()).apply {
      newParams.keys().forEach { k -> put(k, newParams.opt(k)) }
    }
    Log.d(HOST_TAG, "updateParams route=$routeKey size=${newParams.length()}")
  }

  fun attachSurfaceView(view: View) {
    val container = this.view as? ViewGroup
    if (container == null) {
      Log.w(HOST_TAG, "attachSurfaceView called but fragment view is null for route=$routeKey")
      return
    }
    Log.i(HOST_TAG, "attachSurfaceView route=$routeKey, surfaceParent=${view.parent?.javaClass?.simpleName}")
    if (view.parent !== container) {
      (view.parent as? ViewGroup)?.removeView(view)
      container.removeAllViews()
      container.addView(
        view,
        ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      )
      Log.i(HOST_TAG, "Surface attached to fragment $routeKey")
    } else {
      Log.d(HOST_TAG, "Surface already attached to fragment $routeKey")
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
