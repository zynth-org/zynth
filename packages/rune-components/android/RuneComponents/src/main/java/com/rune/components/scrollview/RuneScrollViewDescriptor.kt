package com.rune.components.scrollview

import android.content.Context
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.Style
import org.json.JSONObject

class RuneScrollViewRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(
      RuneComponentDescriptor(
        type = "scroll-view",
        createView = { context: Context, nodeId: Int ->
          RuneScrollView(context).apply {
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT,
              FrameLayout.LayoutParams.MATCH_PARENT,
            )
          }
        },
        onStyleApplied = { node, style: Style ->
          (node.view as? RuneScrollView)?.applyStyle(style)
        },
        onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
          (node.view as? RuneScrollView)?.let { scrollView ->
            scrollView.bind(manager, node.id)
          }
        },
        applyProperty = { node, name, value ->
          (node.view as? RuneScrollView)?.let { scrollView ->
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
        onSetHandler = { node, event ->
          // ScrollView events are handled automatically
          false
        },
        onReset = { node ->
          (node.view as? RuneScrollView)?.let {
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
