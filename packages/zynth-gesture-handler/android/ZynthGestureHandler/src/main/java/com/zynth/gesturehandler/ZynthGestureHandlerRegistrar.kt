package com.zynth.gesturehandler

import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry

class ZynthGestureHandlerRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(
      ZynthComponentDescriptor(
        type = "zynth-gesture-detector",
        createView = { context, _ -> ZynthGestureDetectorView(context) },
        onNodeCreated = { manager, node ->
          (node.view as? ZynthGestureDetectorView)?.bind(manager, node.id)
        },
        applyProperty = { node, name, value ->
          val view = node.view as? ZynthGestureDetectorView ?: return@ZynthComponentDescriptor false
          when (name) {
            "longPressMinDurationMs" -> {
              view.setLongPressMinDurationMs(parseDouble(value, 500.0))
              true
            }
            "flingMinVelocity" -> {
              view.setFlingMinVelocity(parseDouble(value, 800.0))
              true
            }
            "panSharedSignalX" -> {
              view.setPanSharedSignalX(parseInt(value, 0))
              true
            }
            "panSharedSignalY" -> {
              view.setPanSharedSignalY(parseInt(value, 0))
              true
            }
            "onTapGesture",
            "onLongPressGesture",
            "onRotationGesture",
            "onPinchGesture",
            "onFlingGesture",
            "onPanGesture" -> true
            else -> false
          }
        },
        onSetHandler = { node, event ->
          val view = node.view as? ZynthGestureDetectorView ?: return@ZynthComponentDescriptor false
          when (event) {
            "onTapGesture",
            "onLongPressGesture",
            "onRotationGesture",
            "onPinchGesture",
            "onFlingGesture",
            "onPanGesture" -> {
              view.enableEvent(event)
              true
            }
            else -> false
          }
        },
        onReset = { node ->
          (node.view as? ZynthGestureDetectorView)?.reset()
        }
      )
    )
  }

  private fun parseDouble(raw: String?, fallback: Double): Double {
    if (raw == null) return fallback
    val value = raw.trim().trim('"')
    return value.toDoubleOrNull() ?: fallback
  }

  private fun parseInt(raw: String?, fallback: Int): Int {
    if (raw == null) return fallback
    val value = raw.trim().trim('"')
    return when {
      value.isEmpty() -> fallback
      else -> {
        val asInt = value.toIntOrNull()
        if (asInt != null) return asInt
        val asDouble = value.toDoubleOrNull() ?: return fallback
        asDouble.toInt()
      }
    }
  }
}
