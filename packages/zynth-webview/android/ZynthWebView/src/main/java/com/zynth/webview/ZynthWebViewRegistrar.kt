package com.zynth.webview

import android.view.ViewGroup
import android.widget.FrameLayout
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry

class ZynthWebViewRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(
      ZynthComponentDescriptor(
        type = "zynth-webview",
        createView = { context, _ -> ZynthWebViewView(context) },
        onNodeCreated = { manager, node ->
          val view = node.view as? ZynthWebViewView ?: return@ZynthComponentDescriptor
          view.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          )
          view.bind(manager, node.id)
        },
        applyProperty = { node, name, value ->
          val view = node.view as? ZynthWebViewView ?: return@ZynthComponentDescriptor false
          when (name) {
            "source" -> {
              view.setSourceFromRaw(value)
              true
            }
            "javaScriptEnabled" -> {
              view.setJavaScriptEnabled(parseBoolean(value, true))
              true
            }
            "userAgent" -> {
              view.setUserAgent(parseString(value))
              true
            }
            "command" -> {
              view.executeCommandFromRaw(value)
              true
            }
            "onLoadStart", "onLoad", "onLoadEnd", "onError", "onMessage", "onNavigationStateChange", "onNativeReady" -> true
            else -> false
          }
        },
        onSetHandler = { node, event ->
          val view = node.view as? ZynthWebViewView ?: return@ZynthComponentDescriptor false
          when (event) {
            "onNativeReady" -> {
              view.notifyNativeReady()
              true
            }
            "onLoadStart", "onLoad", "onLoadEnd", "onError", "onMessage", "onNavigationStateChange" -> true
            else -> false
          }
        },
        onReset = { node ->
          (node.view as? ZynthWebViewView)?.reset()
        },
      )
    )
  }

  private fun parseBoolean(raw: String?, fallback: Boolean): Boolean {
    if (raw == null) return fallback
    return when (raw.trim().trim('"').lowercase()) {
      "true", "1" -> true
      "false", "0" -> false
      else -> fallback
    }
  }

  private fun parseString(raw: String?): String? {
    if (raw == null) return null
    val trimmed = raw.trim()
    if (trimmed == "null") return null
    return trimmed.trim('"')
  }
}
