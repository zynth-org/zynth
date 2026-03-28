package com.zynth.components.textinput

import android.graphics.Color
import android.util.Log
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject

object TextInputPropAdapter {
  fun apply(node: ZynthUIManager.Node, name: String, value: String?): Boolean {
    val container = node.view as? ZynthTextInputContainer
    val input = container?.getInputView() ?: node.view as? ZynthTextInputView ?: return false

    return when (name) {
      "value" -> {
        val textValue = parseString(value)
        input.updateTextSync(textValue)
        true
      }
      "defaultValue" -> {
        val defaultText = parseString(value)
        // Store default value in the view itself
        input.performProgrammaticUpdate {
          if (input.text.isNullOrEmpty()) {
            input.setText(defaultText)
          }
        }
        true
      }
      "placeholder" -> {
        val placeholder = parseString(value)
        input.applyPlaceholder(placeholder)
        true
      }
      "editable" -> {
        val editable = parseBoolean(value) ?: true
        input.applyEditable(editable)
        true
      }
      "multiline" -> {
        val multiline = parseBoolean(value) ?: false
        input.applyMultiline(multiline)
        true
      }
      "numberOfLines" -> {
        val lines = parseNumber(value)?.toInt() ?: 1
        input.applyNumberOfLines(lines)
        true
      }
      "maxLength" -> {
        val max = parseNumber(value)?.toInt() ?: -1
        input.maxLength = max
        true
      }
      "secureTextEntry" -> {
        val secure = parseBoolean(value) ?: false
        input.applySecureEntry(secure)
        true
      }
      "inputMode" -> {
        val mode = parseString(value)
        input.applyInputMode(mode)
        true
      }
      "autoCapitalize" -> {
        val capitalize = parseString(value)
        input.applyAutoCapitalize(capitalize)
        true
      }
      "autoCorrect" -> {
        val correct = parseBoolean(value)
        input.applyAutoCorrect(correct)
        true
      }
      "spellCheck" -> {
        val spell = parseBoolean(value)
        input.applySpellCheck(spell)
        true
      }
      "returnKeyType" -> {
        val keyType = parseString(value)
        input.applyReturnKeyType(keyType)
        true
      }
      "blurOnSubmit" -> {
        val blur = parseBoolean(value) ?: true
        input.blurOnSubmit = blur
        true
      }
      "submitBehavior" -> {
        val behavior = parseString(value) ?: "submit"
        input.submitBehavior = behavior
        true
      }
      "selection" -> {
        val selection = parseSelection(value)
        if (selection != null) {
          input.applySelection(selection.first, selection.second)
        }
        true
      }
      "selectionColor" -> {
        val color = parseColor(value)
        input.applySelectionColor(color)
        true
      }
      "placeholderTextColor" -> {
        val color = parseColor(value)
        input.applyPlaceholderTextColor(color)
        true
      }
      "caretColor" -> {
        val color = parseColor(value)
        input.applyCaretColor(color)
        true
      }
      "eventThrottleMs" -> {
        val throttle = parseNumber(value)?.toLong() ?: 0L
        input.applyEventThrottle(throttle)
        true
      }
      "syncSignalId" -> {
        val id = parseNumber(value)?.toInt() ?: 0
        input.syncSignalId = id
        true
      }
      "selectTextOnFocus" -> {
        input.selectTextOnFocus = parseBoolean(value) == true
        true
      }
      "requestFocus" -> {
        if (parseBoolean(value) == true) {
          input.requestFocusFromJS()
        }
        true
      }
      "requestBlur" -> {
        if (parseBoolean(value) == true) {
          input.requestBlurFromJS()
        }
        true
      }
      else -> false
    }
  }

  private fun parseString(value: String?): String? {
    if (value == null || value == "null" || value == "undefined") return null
    if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
      return try {
        val obj = JSONObject("{\"v\":$value}")
        obj.getString("v")
      } catch (e: Exception) {
        value.substring(1, value.length - 1)
      }
    }
    return value
  }

  private fun parseBoolean(json: String?): Boolean? {
    if (json == null || json == "null") return null
    return when (json.lowercase()) {
      "true" -> true
      "false" -> false
      else -> try {
        JSONObject("{\"v\":$json}").getBoolean("v")
      } catch (e: Exception) {
        null
      }
    }
  }

  private fun parseNumber(json: String?): Number? {
    if (json == null || json == "null") return null
    return try {
      val obj = JSONObject("{\"v\":$json}")
      when (val value = obj.get("v")) {
        is Number -> value
        else -> null
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun parseColor(json: String?): Int? {
    if (json == null || json == "null") return null
    return try {
      val colorStr = parseString(json) ?: return null
      Color.parseColor(colorStr)
    } catch (e: Exception) {
      null
    }
  }

  private fun parseSelection(json: String?): Pair<Int, Int>? {
    if (json == null || json == "null") return null
    return try {
      val obj = JSONObject(json)
      val start = obj.optInt("start", 0)
      val end = obj.optInt("end", 0)
      start to end
    } catch (e: Exception) {
      null
    }
  }
}
