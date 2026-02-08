package com.zynth.components.scrollview

import android.content.Context
import android.widget.FrameLayout
import android.util.Log
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.layout.Style
import org.json.JSONArray
import org.json.JSONObject

class ZynthScrollViewRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    Log.d("ZynthComponents", "Registered ScrollView component")
    registry.register(
      ZynthComponentDescriptor(
        type = "scroll-view",
        createView = { context: Context, _ ->
          ZynthScrollView(context).apply {
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT,
              FrameLayout.LayoutParams.MATCH_PARENT,
            )
          }
        },
        onStyleApplied = { node, style: Style ->
          (node.view as? ZynthScrollView)?.applyStyle(style)
        },
        onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
          (node.view as? ZynthScrollView)?.let { scrollView ->
            scrollView.bind(manager, node.id)
          }
        },
        applyProperty = { node, name, value ->
          (node.view as? ZynthScrollView)?.let { scrollView ->
            try {
              when (name) {
                "horizontal" -> {
                  scrollView.setAxis(value.toString().toBoolean())
                  true
                }
                "scrollEnabled" -> {
                  scrollView.setScrollEnabled(value.toString().toBoolean())
                  true
                }
                "directionalLockEnabled" -> {
                  scrollView.setDirectionalLockEnabled(value.toString().toBoolean())
                  true
                }
                "showsVerticalScrollIndicator" -> {
                  scrollView.setShowsVerticalScrollIndicator(value.toString().toBoolean())
                  true
                }
                "showsHorizontalScrollIndicator" -> {
                  scrollView.setShowsHorizontalScrollIndicator(value.toString().toBoolean())
                  true
                }
                "indicatorStyle" -> {
                  scrollView.setIndicatorStyle(value?.toString())
                  true
                }
                "overScrollBehavior" -> {
                  scrollView.setOverScrollBehavior(value?.toString())
                  true
                }
                "scrollSnapType" -> {
                  val str = value?.toString()
                  val arg = if (str != null && str.trim().startsWith("{")) {
                    try { JSONObject(str) } catch (e: Exception) { str }
                  } else {
                    str
                  }
                  scrollView.setScrollSnapType(arg)
                  true
                }
                "scrollSnapAlign" -> {
                  val str = value?.toString()
                  val arg = if (str != null && str.trim().startsWith("[")) {
                    try { JSONArray(str) } catch (e: Exception) { str }
                  } else {
                    str
                  }
                  scrollView.setScrollSnapAlign(arg)
                  true
                }
                "scrollSnapStop" -> {
                  scrollView.setScrollSnapStop(value?.toString())
                  true
                }
                "scrollPadding" -> {
                  val str = value?.toString()
                  val arg = if (str != null && str.trim().startsWith("{")) {
                    try { JSONObject(str) } catch (e: Exception) { str }
                  } else {
                    str
                  }
                  scrollView.setScrollPadding(arg)
                  true
                }
                "scrollGuardConfig" -> {
                  val str = value?.toString()
                  val arg = if (str != null && str.trim().startsWith("{")) {
                    try { JSONObject(str) } catch (e: Exception) { null }
                  } else {
                    null
                  }
                  scrollView.setScrollGuardConfig(arg)
                  true
                }
                "contentOffsetSharedValue" -> {
                  scrollView.setContentOffsetSharedValue(value?.toString()?.toDoubleOrNull()?.toInt())
                  true
                }
                "__scrollCommand" -> {
                  val str = value?.toString()
                  if (str != null) {
                    try {
                      scrollView.applyCommand(JSONObject(str))
                    } catch (_: Exception) {}
                  }
                  true
                }
                else -> false
              }
            } catch (e: Exception) {
              false
            }
          } ?: false
        },
        onSetHandler = { _, _ ->
          // ScrollView events are handled automatically
          false
        },
        onReset = { node ->
          (node.view as? ZynthScrollView)?.let {
            it.setAxis(false)
            it.setScrollEnabled(true)
            it.setDirectionalLockEnabled(true)
            it.setShowsVerticalScrollIndicator(true)
            it.setShowsHorizontalScrollIndicator(true)
            it.setIndicatorStyle(null)
            it.setOverScrollBehavior("auto")
          }
        },
      ),
    )
  }
}
