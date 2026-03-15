package com.zynth.components.bottomsheet

import android.graphics.Color
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

object ZynthBottomSheetDescriptor {
  fun create(): ZynthComponentDescriptor {
    return ZynthComponentDescriptor(
      type = "zynth-bottom-sheet",
      createView = { context, _ -> ZynthBottomSheetLayout(context) },
      onNodeCreated = { manager, node ->
        (node.view as? ZynthBottomSheetLayout)?.bind(manager, node)
      },
      applyProperty = { node, name, value ->
        val layout = node.view as? ZynthBottomSheetLayout ?: return@ZynthComponentDescriptor false
        when (name) {
          "snapPoints" -> {
            parseSnapPoints(value)?.let { layout.updateLayoutOptions { copy(snapPoints = it) } }
            true
          }
          "overlayColor" -> {
            parseColor(value)?.let { layout.setOverlayColor(it) }
            true
          }
          "overlayOpacity" -> {
            parseFloat(value)?.let { layout.setOverlayOpacity(it) }
            true
          }
          "dismissOnOverlayPress" -> {
            parseBoolean(value)?.let { layout.setDismissOnOverlayPress(it) }
            true
          }
          "allowBackgroundInteraction" -> {
            parseBoolean(value)?.let { enabled ->
              layout.updateLayoutOptions { copy(allowBackgroundInteraction = enabled) }
            }
            true
          }
          "allowDismissOnInteraction" -> {
            parseBoolean(value)?.let { enabled ->
              layout.updateLayoutOptions { copy(allowDismissOnInteraction = enabled) }
            }
            true
          }
          "dynamicContentHeight" -> {
            parseBoolean(value)?.let { enabled ->
              layout.updateLayoutOptions { copy(dynamicContentHeight = enabled) }
            }
            true
          }
          "contentHeightHint" -> {
            val parsed = parsePrimitive(value)
            val hint = when (parsed) {
              null -> null
              is Number -> parsed.toFloat()
              is String -> parsed.toFloatOrNull()
              else -> null
            }?.takeIf { it > 0f }
            layout.updateLayoutOptions { copy(contentHeightHintDp = hint) }
            true
          }
          "initialSnapIndex" -> {
            parseInt(value)?.let { layout.updateLayoutOptions { copy(initialSnapIndex = it.coerceAtLeast(0)) } }
            true
          }
          "open" -> {
            parseBoolean(value)?.let { if (it) layout.open() else layout.close() }
            true
          }
          "__command" -> {
            parseJsonObject(value)?.let { command ->
              when (command.optString("type")) {
                "open" -> {
                  if (command.has("index")) {
                    layout.open(command.optInt("index"))
                  } else {
                    layout.open()
                  }
                }
                "close" -> layout.close()
                "snapTo" -> command.takeIf { it.has("index") }?.let {
                  layout.snapTo(it.optInt("index"))
                }
                "expand" -> layout.expand()
                "collapse" -> layout.collapse()
                else -> Unit
              }
            }
            true
          }
          else -> false
        }
      },
      onSetHandler = { _, event ->
        event == "onSnapChange" || event == "onDismiss" || event == "onOpenChange"
      },
      onReset = { node ->
        (node.view as? ZynthBottomSheetLayout)?.reset()
      },
    )
  }

  private fun parseSnapPoints(value: String?): List<BottomSheetSnapPoint>? {
    val trimmed = value?.trim() ?: return null
    if (trimmed.isEmpty() || trimmed == "null") return null
    return try {
      val array = JSONArray(trimmed)
      val result = mutableListOf<BottomSheetSnapPoint>()
      for (index in 0 until array.length()) {
        when (val item = array.get(index)) {
          is Number -> result.add(BottomSheetSnapPoint.Absolute(item.toFloat()))
          is String -> BottomSheetSnapPoint.parse(item)?.let { parsed -> result.add(parsed) }
        }
      }
      result
    } catch (error: JSONException) {
      null
    }
  }

  private fun parseColor(value: String?): Int? {
    val parsed = parsePrimitive(value) as? String ?: return null
    return try {
      Color.parseColor(parsed)
    } catch (_: IllegalArgumentException) {
      null
    }
  }

  private fun parseFloat(value: String?): Float? {
    val parsed = parsePrimitive(value) ?: return null
    return when (parsed) {
      is Number -> parsed.toFloat()
      is String -> parsed.toFloatOrNull()
      else -> null
    }
  }

  private fun parseBoolean(value: String?): Boolean? {
    val parsed = parsePrimitive(value) ?: return null
    return when (parsed) {
      is Boolean -> parsed
      is String -> {
        when (parsed.lowercase()) {
          "true" -> true
          "false" -> false
          else -> null
        }
      }
      else -> null
    }
  }

  private fun parseInt(value: String?): Int? {
    val parsed = parsePrimitive(value) ?: return null
    return when (parsed) {
      is Number -> parsed.toInt()
      is String -> parsed.toDoubleOrNull()?.toInt()
      else -> null
    }
  }

  private fun parsePrimitive(value: String?): Any? {
    if (value.isNullOrBlank() || value == "null") return null
    return try {
      val token = JSONTokener(value.trim()).nextValue()
      if (token === JSONObject.NULL) null else token
    } catch (_: JSONException) {
      value.trim().trim('"')
    }
  }

  private fun parseJsonObject(value: String?): JSONObject? {
    val trimmed = value?.trim() ?: return null
    if (trimmed.isEmpty() || trimmed == "null") return null
    return try {
      JSONObject(trimmed)
    } catch (_: JSONException) {
      null
    }
  }
}
