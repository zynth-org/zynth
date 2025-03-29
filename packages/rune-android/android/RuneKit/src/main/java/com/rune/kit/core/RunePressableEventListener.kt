package com.rune.kit.core

import org.json.JSONObject

/**
 * Event contract for pressable-style components. Implemented by [RuneUIManager]
 * so component packages can forward native interaction events back to the host.
 */
interface RunePressableEventListener {
  fun onPressablePressIn(nodeId: Int, payload: JSONObject)
  fun onPressablePressOut(nodeId: Int, payload: JSONObject, cancelled: Boolean)
  fun onPressablePress(nodeId: Int, payload: JSONObject)
  fun onPressableLongPress(nodeId: Int, durationMs: Long, payload: JSONObject)
  fun onPressableDoublePress(nodeId: Int, payload: JSONObject)
  fun onPressableHover(nodeId: Int, hovering: Boolean)
  fun onPressableFocus(nodeId: Int)
  fun onPressableBlur(nodeId: Int)
  fun onPressableKeyEvent(nodeId: Int, phase: String, payload: JSONObject)
  fun onPressableCancel(nodeId: Int, payload: JSONObject)
}
