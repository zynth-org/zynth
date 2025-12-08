package com.rune.components.datepicker

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager
import org.json.JSONObject

class DatePickerComponentRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(createDatePickerViewDescriptor())
    registry.register(createDatePickerTriggerDescriptor())
    Log.d("RuneComponents", "Registered DatePicker component")
  }
}

private fun createDatePickerViewDescriptor(): RuneComponentDescriptor {
  return RuneComponentDescriptor(
    type = "date-picker-view",
    createView = { context: Context, _ ->
      RuneDatePickerView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { manager: RuneUIManager, node: RuneUIManager.Node ->
      (node.view as? RuneDatePickerView)?.let { pickerView ->
        pickerView.manager = manager
        pickerView.nodeId = node.id
      }
      node.mountHasVisualProps = true
      node.mountAwaitingFirstProps = false
    },
    applyProperty = { node, name, value ->
      val pickerView = node.view as? RuneDatePickerView ?: return@RuneComponentDescriptor false
      when (name) {
        "mode" -> {
          pickerView.mode = parseStringValue(value, name) ?: "date"
          true
        }
        "title" -> {
          pickerView.setTitleText(parseStringValue(value, name))
          true
        }
        "value", "selection" -> {
          val range = parseRangeValue(value)
          if (range != null) {
            pickerView.setRangeSelection(range.start, range.end)
          } else {
            pickerView.setSelection(parseLongValue(value, name))
          }
          true
        }
        "confirmText" -> {
          pickerView.setConfirmText(parseStringValue(value, name))
          true
        }
        "cancelText" -> {
          pickerView.setCancelText(parseStringValue(value, name))
          true
        }
        "__command" -> {
          pickerView.handleCommand(parseString(value))
          true
        }
        else -> false
      }
    },
    onSetHandler = { node, event ->
      val pickerView = node.view as? RuneDatePickerView ?: return@RuneComponentDescriptor false
      when (event) {
        "onChange" -> {
          pickerView.hasOnChangeHandler = true
          true
        }
        "onRangeChange" -> {
          pickerView.hasOnRangeHandler = true
          true
        }
        "onCancel" -> {
          pickerView.hasOnCancelHandler = true
          true
        }
        "onDismiss" -> {
          pickerView.hasOnDismissHandler = true
          true
        }
        else -> false
      }
    },
    onReset = { node ->
      (node.view as? RuneDatePickerView)?.reset()
    },
  )
}

private fun createDatePickerTriggerDescriptor(): RuneComponentDescriptor {
  return RuneComponentDescriptor(
    type = "date-picker-trigger-view",
    createView = { context: Context, _ ->
      RuneDatePickerTriggerView(context).apply {
        layoutParams = layoutParams ?: FrameLayout.LayoutParams(
          FrameLayout.LayoutParams.WRAP_CONTENT,
          FrameLayout.LayoutParams.WRAP_CONTENT,
        )
      }
    },
    onNodeCreated = { _, node ->
      node.mountHasVisualProps = true
      node.mountAwaitingFirstProps = false
    },
    onReset = { node ->
      (node.view as? RuneDatePickerTriggerView)?.reset()
    },
  )
}

private fun parseStringValue(json: String?, propName: String): String? {
  if (json == null || json == "null") return null
  return try {
    val obj = JSONObject(json)
    if (obj.isNull(propName)) null else obj.optString(propName)
  } catch (_: Exception) {
    try {
      val wrapped = JSONObject("{\"v\":$json}")
      wrapped.getString("v")
    } catch (_: Exception) {
      json.trim('"')
    }
  }
}

private fun parseString(value: String?): String? {
  val trimmed = value?.trim() ?: return null
  if (trimmed.isEmpty() || trimmed == "null") return null

  return try {
    val token = org.json.JSONTokener(trimmed).nextValue()
    when {
      token === JSONObject.NULL -> null
      token is String -> token
      else -> trimmed
    }
  } catch (_: Exception) {
    trimmed.trim('"')
  }
}

private fun parseLongValue(json: String?, propName: String): Long? {
  if (json == null || json == "null") return null
  try {
    val obj = JSONObject(json)
    if (obj.has(propName) && !obj.isNull(propName)) {
      return obj.getLong(propName)
    }
  } catch (_: Exception) {
  }

  return try {
    val wrapped = JSONObject("{\"v\":$json}")
    if (wrapped.isNull("v")) null else wrapped.getLong("v")
  } catch (_: Exception) {
    json.toLongOrNull() ?: json.toDoubleOrNull()?.toLong()
  }
}

private data class DateRangeSelection(val start: Long?, val end: Long?)

private fun parseRangeValue(json: String?): DateRangeSelection? {
  if (json == null || json == "null") return null
  val trimmed = json.trim()
  if (trimmed.isEmpty()) return null

  return try {
    if (trimmed.startsWith("[")) {
      val array = org.json.JSONArray(trimmed)
      val start = if (array.length() > 0 && !array.isNull(0)) {
        array.optDouble(0).toLong()
      } else {
        null
      }
      val end = if (array.length() > 1 && !array.isNull(1)) {
        array.optDouble(1).toLong()
      } else {
        null
      }
      DateRangeSelection(start, end)
    } else {
      val obj = JSONObject(trimmed)
      if (!obj.has("start") && !obj.has("end")) return null
      val start = if (obj.isNull("start")) null else obj.optDouble("start").toLong()
      val end = if (obj.isNull("end")) null else obj.optDouble("end").toLong()
      DateRangeSelection(start, end)
    }
  } catch (_: Exception) {
    null
  }
}
