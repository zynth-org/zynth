package com.rune.components.button

import android.content.Context
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager
import org.json.JSONObject

class RuneButtonRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(
      RuneComponentDescriptor(
        type = "Button",
        createView = { context: Context, nodeId: Int ->
          RuneButtonView(context).apply {
            this.nodeId = nodeId
            layoutParams = layoutParams ?: FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.WRAP_CONTENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            )
          }
        },
        onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
          (node.view as? RuneButtonView)?.let { button ->
            button.nodeId = node.id
            button.listener = object : RuneButtonView.Listener {
              override fun onPressIn(nodeId: Int) {
                manager.dispatchEvent(nodeId, "onPressIn", JSONObject())
              }

              override fun onPressOut(nodeId: Int, cancelled: Boolean) {
                manager.dispatchEvent(nodeId, "onPressOut", JSONObject().put("cancelled", cancelled))
              }

              override fun onPress(nodeId: Int) {
                manager.dispatchEvent(nodeId, "onPress", JSONObject())
              }

              override fun onLongPress(nodeId: Int, durationMs: Long) {
                manager.dispatchEvent(nodeId, "onLongPress", JSONObject().put("durationMs", durationMs))
              }

              override fun onFocus(nodeId: Int) {
                manager.dispatchEvent(nodeId, "onFocus", JSONObject())
              }

              override fun onBlur(nodeId: Int) {
                manager.dispatchEvent(nodeId, "onBlur", JSONObject())
              }

              override fun onKeyEvent(nodeId: Int, phase: String, key: String?) {
                val payload = if (key != null && key.isNotEmpty()) {
                  JSONObject().put("key", key)
                } else {
                  JSONObject()
                }
                manager.dispatchEvent(nodeId, phase, payload)
              }
            }
          }
        },
        applyProperty = { node, name, value ->
          (node.view as? RuneButtonView)?.let { button ->
            try {
              when (name) {
                "disabled" -> {
                  val disabled = if (value != null) JSONObject(value).optBoolean(name, false) else false
                  button.setDisabled(disabled)
                  true
                }
                "loading" -> {
                  val loading = if (value != null) JSONObject(value).optBoolean(name, false) else false
                  button.setLoading(loading)
                  true
                }
                "pressEffect" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  val effect = obj.optString(name)
                  button.setPressEffect(effect)
                  true
                }
                "pressRetentionOffset" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  val offset = obj.optDouble(name, -1.0).takeIf { it >= 0 }
                  button.setPressRetentionOffset(offset?.let { it as Number })
                  true
                }
                "hitSlop" -> {
                  val hitSlop = if (value != null) JSONObject(value).optJSONObject(name) else null
                  button.setHitSlop(hitSlop)
                  true
                }
                "minimumTouchSize" -> {
                  val size = if (value != null) JSONObject(value).optJSONObject(name) else null
                  button.setMinimumTouchSize(size)
                  true
                }
                "preventFocusOnPress" -> {
                  val prevent = if (value != null) JSONObject(value).optBoolean(name, false) else false
                  button.setPreventFocusOnPress(prevent)
                  true
                }
                "haptics" -> {
                  val obj = if (value != null) JSONObject(value) else JSONObject()
                  val mode = obj.optString(name)
                  button.setHapticsMode(mode)
                  true
                }
                "__buttonCommand" -> {
                  val command = if (value != null) JSONObject(value) else null
                  button.handleCommand(command)
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
          val button = node.view as? RuneButtonView ?: return@RuneComponentDescriptor false
          if (event == "onLongPress") {
            button.setHasLongPressHandler(true)
            true
          } else {
            false
          }
        },
        onReset = { node ->
          (node.view as? RuneButtonView)?.let {
            it.setDisabled(false)
            it.setLoading(false)
            it.setPressEffect("ripple")
            it.setPressRetentionOffset(null)
            it.setHitSlop(null)
            it.setMinimumTouchSize(null)
            it.setPreventFocusOnPress(false)
            it.setHapticsMode("none")
            it.setHasLongPressHandler(false)
          }
        },
      ),
    )
  }
}
