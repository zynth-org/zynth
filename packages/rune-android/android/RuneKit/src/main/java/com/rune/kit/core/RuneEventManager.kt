package com.rune.kit.core

import android.util.SparseArray
import com.rune.kit.layout.LayoutEngine
import org.json.JSONException
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.HashMap

/**
 * RuneEventManager handles all event-related operations for the Rune UI framework.
 * 
 * Responsibilities:
 * - Event payload storage and consumption
 * - Event dispatch to native handlers
 * - Event callback handling for Button, Pressable, and TextInput components
 */
internal class RuneEventManager(
    private val nodes: SparseArray<RuneUIManager.Node>,
    private val engine: LayoutEngine,
    private val eventDispatcher: (Int, String) -> Unit,
    private val handlerListener: (Int, String, Long) -> Unit,
    private val eventPayloads: HashMap<String, ArrayDeque<String>>,
    private val ensureTextInputState: (RuneUIManager.Node) -> RuneUIManager.TextInputState,
) {

  // ==================== Event Payload Management ====================

  /**
   * Generates a unique key for event payload storage.
   * Format: "nodeId::eventName"
   */
  private fun eventKey(nodeId: Int, event: String): String = "$nodeId::$event"

  /**
   * Stores an event payload in the event queue for later consumption.
   * Payload is stored as JSON string to be dequeued by native layer.
   */
  internal fun storeEventPayload(nodeId: Int, event: String, payload: JSONObject?) {
    val key = eventKey(nodeId, event)
    synchronized(eventPayloads) {
      if (payload != null && payload.length() > 0) {
        val queue = eventPayloads.getOrPut(key) { ArrayDeque() }
        queue.addLast(payload.toString())
      } else {
        eventPayloads.remove(key)
      }
    }
  }

  /**
   * Consumes and returns a single event payload from the queue as JSONObject.
   * Returns null if no payload is available.
   */
  internal fun consumeEventPayload(nodeId: Int, event: String): JSONObject? {
    val key = eventKey(nodeId, event)
    synchronized(eventPayloads) {
      val queue = eventPayloads[key] ?: return null
      if (queue.isEmpty()) {
        eventPayloads.remove(key)
        return null
      }
      val payloadJson = queue.removeFirst()
      if (queue.isEmpty()) {
        eventPayloads.remove(key)
      }
      return try {
        JSONObject(payloadJson)
      } catch (_: JSONException) {
        null
      }
    }
  }

  /**
   * Consumes and returns a single event payload from the queue as JSON string.
   * Returns null if no payload is available.
   */
  internal fun dequeueEventPayloadJson(nodeId: Int, event: String): String? {
    val key = eventKey(nodeId, event)
    synchronized(eventPayloads) {
      val queue = eventPayloads[key] ?: return null
      if (queue.isEmpty()) {
        eventPayloads.remove(key)
        return null
      }
      val payload = queue.removeFirst()
      if (queue.isEmpty()) {
        eventPayloads.remove(key)
      }
      return payload
    }
  }

  // ==================== Event Dispatch ====================

  /**
   * Emits a TextInput-specific event by storing payload and dispatching to native layer.
   * Used for text input events (onChangeText, onFocus, onBlur, etc.)
   */
  internal fun emitTextInputEvent(nodeId: Int, event: String, payload: JSONObject?) {
    storeEventPayload(nodeId, event, payload)
    eventDispatcher(nodeId, event)
  }

  /**
   * Generic event dispatcher that stores payload and dispatches to native layer.
   * Used by all Button, Pressable, and TextInput event callbacks.
   */
  internal fun dispatchEvent(nodeId: Int, event: String, payload: JSONObject?) {
    storeEventPayload(nodeId, event, payload)
    eventDispatcher(nodeId, event)
  }

  // ==================== Button Events ====================

  /**
   * Called when a button is pressed (onPressIn).
   * Dispatches event without payload.
   */
  internal fun onPressIn(nodeId: Int) {
    dispatchEvent(nodeId, "onPressIn", null)
  }

  /**
   * Called when a button press ends (onPressOut).
   * Includes cancelled flag in payload.
   */
  internal fun onPressOut(nodeId: Int, cancelled: Boolean) {
    val payload = JSONObject().put("cancelled", cancelled)
    dispatchEvent(nodeId, "onPressOut", payload)
  }

  /**
   * Called when a button is pressed and released (onPress).
   * Marks as non-synthetic in payload.
   */
  internal fun onPress(nodeId: Int) {
    val payload = JSONObject().put("synthetic", false)
    dispatchEvent(nodeId, "onPress", payload)
  }

  /**
   * Called when a button is long-pressed (onLongPress).
   * Includes duration in milliseconds.
   */
  internal fun onLongPress(nodeId: Int, durationMs: Long) {
    val payload = JSONObject().put("durationMs", durationMs)
    dispatchEvent(nodeId, "onLongPress", payload)
  }

  /**
   * Called when a button receives focus (onFocus).
   * Dispatches event without payload.
   */
  internal fun onFocus(nodeId: Int) {
    dispatchEvent(nodeId, "onFocus", null)
  }

  /**
   * Called when a button loses focus (onBlur).
   * Dispatches event without payload.
   */
  internal fun onBlur(nodeId: Int) {
    dispatchEvent(nodeId, "onBlur", null)
  }

  /**
   * Called when a button receives a key event.
   * Phase is typically "onKeyDown" or "onKeyUp".
   * Key name is optional and included in payload if present.
   */
  internal fun onKeyEvent(nodeId: Int, phase: String, key: String?) {
    val payload = JSONObject()
    if (!key.isNullOrEmpty()) {
      payload.put("key", key)
    }
    dispatchEvent(nodeId, phase, if (payload.length() == 0) null else payload)
  }

  // ==================== Pressable Events ====================

  /**
   * Called when a pressable view is pressed (onPressIn).
   * Payload contains pressable-specific metadata.
   */
  internal fun onPressablePressIn(nodeId: Int, payload: JSONObject) {
    dispatchEvent(nodeId, "onPressIn", payload)
  }

  /**
   * Called when a pressable view press ends (onPressOut).
   * Adds cancelled flag to payload and dispatches.
   */
  internal fun onPressablePressOut(nodeId: Int, payload: JSONObject, cancelled: Boolean) {
    payload.put("cancelled", cancelled)
    dispatchEvent(nodeId, "onPressOut", payload)
  }

  /**
   * Called when a pressable view is pressed and released (onPress).
   * Payload contains pressable-specific metadata.
   */
  internal fun onPressablePress(nodeId: Int, payload: JSONObject) {
    dispatchEvent(nodeId, "onPress", payload)
  }

  /**
   * Called when a pressable view is long-pressed (onLongPress).
   * Adds duration to payload and dispatches.
   */
  internal fun onPressableLongPress(nodeId: Int, durationMs: Long, payload: JSONObject) {
    payload.put("durationMs", durationMs)
    dispatchEvent(nodeId, "onLongPress", payload)
  }

  /**
   * Called when a pressable view receives a double-press (onDoublePress).
   * Payload contains pressable-specific metadata.
   */
  internal fun onPressableDoublePress(nodeId: Int, payload: JSONObject) {
    dispatchEvent(nodeId, "onDoublePress", payload)
  }

  /**
   * Called when a pressable view hover state changes (onHoverIn/onHoverOut).
   * Event name depends on hovering flag.
   */
  internal fun onPressableHover(nodeId: Int, hovering: Boolean) {
    val event = if (hovering) "onHoverIn" else "onHoverOut"
    dispatchEvent(nodeId, event, null)
  }

  /**
   * Called when a pressable view receives focus (onFocus).
   * Dispatches event without payload.
   */
  internal fun onPressableFocus(nodeId: Int) {
    dispatchEvent(nodeId, "onFocus", null)
  }

  /**
   * Called when a pressable view loses focus (onBlur).
   * Dispatches event without payload.
   */
  internal fun onPressableBlur(nodeId: Int) {
    dispatchEvent(nodeId, "onBlur", null)
  }

  /**
   * Called when a pressable view receives a key event.
   * Payload contains key event details.
   */
  internal fun onPressableKeyEvent(nodeId: Int, phase: String, payload: JSONObject) {
    dispatchEvent(nodeId, phase, payload)
  }

  /**
   * Called when a pressable view is cancelled.
   * Note: Cancellation is surfaced via onPressOut with cancelled flag instead.
   */
  internal fun onPressableCancel(nodeId: Int, payload: JSONObject) {
    // Cancellation is surfaced via onPressOut with the cancelled flag.
  }

  // ==================== TextInput Events ====================

  /**
   * Called when TextInput text content changes.
   * Updates node state and dispatches event to native layer.
   * Handles pending selection application if needed.
   */
  internal fun onTextInputTextUpdated(nodeId: Int, text: String) {
    val node = nodes.get(nodeId) ?: return
    val state = ensureTextInputState(node)
    state.currentText = text
    state.hasAppliedInitialText = true
    state.awaitingInitialValue = false
    node.cachedText = text
    state.pendingSelection?.let { pending ->
      val inputView = node.view as? RuneTextInputView
      if (inputView != null) {
        inputView.post {
          inputView.applySelection(pending.start, pending.end)
          state.pendingSelection = null
        }
      }
    }
  }

  /**
   * Called when TextInput layout measurements change.
   * Stores exact height for measurement optimization.
   */
  internal fun onTextInputLayout(nodeId: Int, height: Int) {
    if (height <= 0) return
    val node = nodes.get(nodeId) ?: return
    val state = ensureTextInputState(node)
    state.lastExactHeight = height
  }

  /**
   * Clears the cached exact height for a TextInput.
   * Used to reset measurement cache when needed.
   */
  internal fun clearTextInputExactHeight(nodeId: Int) {
    val node = nodes.get(nodeId) ?: return
    val state = ensureTextInputState(node)
    state.lastExactHeight = 0
  }

  /**
   * Called when TextInput intrinsic size changes.
   * Marks node dirty and schedules a layout flush.
   */
  internal fun onTextInputIntrinsicSizeChanged(nodeId: Int) {
    engine.markDirty(nodeId)
    // Note: scheduleFlush is called by the caller
  }
}
