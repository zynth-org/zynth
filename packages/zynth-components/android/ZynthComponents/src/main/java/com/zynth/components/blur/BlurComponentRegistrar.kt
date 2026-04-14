package com.zynth.components.blur

import android.content.Context
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import com.zynth.components.view.ZynthViewContainer
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

class BlurComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(createBlurComponentDescriptor())
    Log.d("ZynthComponents", "Registered BlurView component")
  }
}

private fun createBlurComponentDescriptor(): ZynthComponentDescriptor {
  return ZynthComponentDescriptor(
    type = "blur-view",
    createView = { context: Context, _ ->
      ZynthBlurView(context).apply {
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { manager: ZynthUIManager, node: ZynthUIManager.Node ->
      val blurView = node.view as? ZynthBlurView ?: return@ZynthComponentDescriptor
      blurView.manager = manager
      blurView.nodeId = node.id
    },
    applyProperty = { node, name, value ->
      val blurView = node.view as? ZynthBlurView ?: return@ZynthComponentDescriptor false
      when (name) {
        "pointerEvents" -> {
          val modeString = parseString(value) ?: "auto"
          val mode = when (modeString.lowercase()) {
            "none" -> ZynthViewContainer.PointerEventsMode.NONE
            "box-none" -> ZynthViewContainer.PointerEventsMode.BOX_NONE
            "box-only" -> ZynthViewContainer.PointerEventsMode.BOX_ONLY
            else -> ZynthViewContainer.PointerEventsMode.AUTO
          }
          blurView.pointerMode = mode
          true
        }
        "blurIntensity", "blurTint", "blurVariant", "tintColor" -> true
        else -> false
      }
    },
    onStyleApplied = { node, style ->
      val blurView = node.view as? ZynthBlurView ?: return@ZynthComponentDescriptor
      val shouldClip = style.overflow?.let { overflow ->
        overflow.equals("hidden", ignoreCase = true) ||
          overflow.equals("scroll", ignoreCase = true)
      } ?: false
      blurView.clipChildren = shouldClip
      blurView.clipToPadding = shouldClip
    },
    onSetHandler = { node, event ->
      val blurView = node.view as? ZynthBlurView ?: return@ZynthComponentDescriptor false
      if (event == "onPress") {
        blurView.hasOnPressHandler = true
        blurView.setOnClickListener {
          if (!blurView.hasOnPressHandler) return@setOnClickListener
          val manager = blurView.manager ?: return@setOnClickListener
          val nodeId = blurView.nodeId
          if (nodeId >= 0) {
            manager.dispatchEvent(nodeId, "onPress", null)
          }
        }
        val mode = blurView.pointerMode
        blurView.isClickable =
          mode != ZynthViewContainer.PointerEventsMode.NONE &&
            mode != ZynthViewContainer.PointerEventsMode.BOX_NONE
        true
      } else {
        false
      }
    },
    onReset = { node ->
      val blurView = node.view as? ZynthBlurView ?: return@ZynthComponentDescriptor
      blurView.pointerMode = ZynthViewContainer.PointerEventsMode.AUTO
      blurView.setOverflowHidden(false)
      blurView.setBorderRadii(0f, 0f, 0f, 0f)
      blurView.hasOnPressHandler = false
      blurView.setOnClickListener(null)
      blurView.isClickable = false
      blurView.manager = null
      blurView.nodeId = -1
    },
  )
}

private fun parseString(value: String?): String? {
  val trimmed = value?.trim() ?: return null
  if (trimmed.isEmpty() || trimmed == "null") return null

  return try {
    val token = JSONTokener(trimmed).nextValue()
    when {
      token === JSONObject.NULL -> null
      token is String -> token
      else -> trimmed
    }
  } catch (_: JSONException) {
    trimmed.trim('"')
  }
}
