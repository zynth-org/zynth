package com.zynth.components.scrollview

import android.content.Context
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.layout.Style
import org.json.JSONObject

class ZynthScrollViewRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
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
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  val horizontal = obj.optBoolean(name, false)
                  scrollView.setAxis(horizontal)
                  true
                }
                "scrollEnabled" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setScrollEnabled(obj.optBoolean(name, true))
                  true
                }
                "directionalLockEnabled" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setDirectionalLockEnabled(obj.optBoolean(name, true))
                  true
                }
                "showsVerticalScrollIndicator" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setShowsVerticalScrollIndicator(obj.optBoolean(name, true))
                  true
                }
                "showsHorizontalScrollIndicator" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setShowsHorizontalScrollIndicator(obj.optBoolean(name, true))
                  true
                }
                "indicatorStyle" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setIndicatorStyle(obj.optString(name))
                  true
                }
                "overScrollBehavior" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setOverScrollBehavior(obj.optString(name))
                  true
                }
                "scrollSnapType" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setScrollSnapType(obj.opt(name))
                  true
                }
                "scrollSnapAlign" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setScrollSnapAlign(obj.opt(name))
                  true
                }
                "scrollSnapStop" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setScrollSnapStop(obj.opt(name))
                  true
                }
                "scrollPadding" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setScrollPadding(obj.opt(name))
                  true
                }
                "scrollGuardConfig" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  scrollView.setScrollGuardConfig(obj.opt(name))
                  true
                }
                "__scrollCommand" -> {
                  val obj = if (value != null) JSONObject(value) else null
                  obj?.let { scrollView.applyCommand(it) }
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
