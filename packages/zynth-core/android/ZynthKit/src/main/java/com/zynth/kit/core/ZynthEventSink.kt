package com.zynth.kit.core

import org.json.JSONObject

/**
 * Generic event sink for native components to dispatch events back to JS.
 * Keeps core agnostic of component-specific event contracts.
 */
interface ZynthEventSink {
  fun dispatchEvent(nodeId: Int, event: String, payload: JSONObject?)
}
