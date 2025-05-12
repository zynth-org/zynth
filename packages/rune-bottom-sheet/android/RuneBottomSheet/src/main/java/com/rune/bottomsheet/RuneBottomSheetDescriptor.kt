package com.rune.bottomsheet

import android.graphics.Color
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.core.RuneUIManager
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

object RuneBottomSheetDescriptor {
  fun create(): RuneComponentDescriptor {
    return RuneComponentDescriptor(
      type = "RuneBottomSheet",
      createView = { context, _ -> RuneBottomSheetLayout(context) },
      onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
        val layout = node.view as? RuneBottomSheetLayout ?: return@RuneComponentDescriptor
        layout.setSnapChangedListener { index, progress ->
          val payload = JSONObject().put("index", index).put("progress", progress)
          manager.dispatchEvent(node.id, "onSnapChange", payload)
        }
        layout.setOnDismissListener {
          manager.dispatchEvent(node.id, "onDismiss", null)
        }
      },
      applyProperty = { node, name, value ->
        val layout = node.view as? RuneBottomSheetLayout ?: return@RuneComponentDescriptor false
        when (name) {
          "snapPoints" -> {
            parseSnapPoints(value)?.let {
              layout.updateLayoutOptions { copy(snapPoints = it) }
            }
            true
          }
          "overlayColor" -> {
            parseColor(value)?.let {
              layout.updateLayoutOptions { copy(overlayColor = it) }
            }
            true
          }
          "overlayOpacity" -> {
            parseFloat(value)?.let {
              layout.updateLayoutOptions { copy(overlayOpacity = it) }
            }
            true
          }
          "dismissOnOverlayPress" -> {
            parseBoolean(value)?.let {
              layout.updateLayoutOptions { copy(dismissOnOverlayPress = it) }
            }
            true
          }
          "initialIndex" -> {
            parseInt(value)?.let {
              layout.updateLayoutOptions { copy(initialIndex = it) }
            }
            true
          }
          else -> false
        }
      },
      onSetHandler = { _, event ->
        event == "onSnapChange" || event == "onDismiss"
      },
      onReset = { node ->
        (node.view as? RuneBottomSheetLayout)?.applyLayoutOptions(null)
      },
    )
  }

  private fun parseSnapPoints(value: String?): List<String>? {
    val trimmed = value?.trim() ?: return null
    if (trimmed.isEmpty() || trimmed == "null") return null
    return try {
      val array = JSONArray(trimmed)
      val result = mutableListOf<String>()
      for (index in 0 until array.length()) {
        when (val item = array.get(index)) {
          is Number -> result.add(item.toString())
          is String -> if (item.isNotBlank()) result.add(item)
        }
      }
      result.takeIf { it.isNotEmpty() }
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
    } catch (error: JSONException) {
      value.trim().trim('"')
    }
  }
}
