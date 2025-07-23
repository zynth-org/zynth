package com.rune.kit.core

import org.json.JSONArray
import kotlin.math.PI
import kotlin.math.abs

data class RuneGradientStop(val color: Int, val position: Float?)
data class RuneLinearGradient(val angle: Float, val stops: List<RuneGradientStop>)

object RuneGradientParser {

  fun parse(value: Any?): RuneLinearGradient? {
    var candidate: Any? = value
    if (candidate is String) {
      val trimmedStr = candidate.trim()
      if (trimmedStr.startsWith("[")) {
        runCatching { JSONArray(trimmedStr) }.getOrNull()?.let { candidate = it }
      } else {
        candidate = trimmedStr
      }
    }
    val raw = when (val c = candidate) {
      is JSONArray -> if (c.length() > 0) c.optString(0) else null
      is String -> c
      else -> c?.toString()
    }?.trim() ?: return null

    return parseLinearGradient(raw)
  }

  private fun parseLinearGradient(raw: String): RuneLinearGradient? {
    if (!raw.startsWith("linear-gradient", ignoreCase = true)) return null
    val open = raw.indexOf('(')
    val close = raw.lastIndexOf(')')
    if (open < 0 || close <= open) return null
    val args = raw.substring(open + 1, close)
    val tokens = splitArgs(args)
    if (tokens.size < 2) return null

    var angle = 180f
    var startIndex = 0
    parseAngle(tokens.first())?.let {
      angle = it
      startIndex = 1
    }

    val stops = mutableListOf<RuneGradientStop>()
    for (i in startIndex until tokens.size) {
      parseStop(tokens[i])?.let { stops.add(it) }
    }
    if (stops.size < 2) return null

    return RuneLinearGradient(normalizeAngle(angle), stops)
  }

  private fun parseAngle(token: String): Float? {
    val trimmed = token.trim()
    if (trimmed.startsWith("to ", ignoreCase = true)) {
      return parseDirection(trimmed.removePrefix("to ").trim())
    }
    val pattern = Regex("^(-?[0-9.]+)(deg|rad|turn)?$", RegexOption.IGNORE_CASE)
    val match = pattern.find(trimmed) ?: return null
    val value = match.groupValues[1].toFloatOrNull() ?: return null
    return when (match.groupValues[2].lowercase()) {
      "deg", "" -> value
      "rad" -> (value * 180f / PI.toFloat())
      "turn" -> value * 360f
      else -> null
    }
  }

  private fun parseDirection(dir: String): Float? {
    val parts = dir.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
    var vertical: Float? = null
    var horizontal: Float? = null
    for (p in parts) {
      when (p) {
        "top" -> vertical = 0f
        "bottom" -> vertical = 180f
        "left" -> horizontal = 270f
        "right" -> horizontal = 90f
      }
    }
    return when {
      vertical != null && horizontal != null -> {
        when {
          vertical == 0f && horizontal == 90f -> 45f
          vertical == 0f && horizontal == 270f -> 315f
          vertical == 180f && horizontal == 90f -> 135f
          vertical == 180f && horizontal == 270f -> 225f
          else -> vertical ?: horizontal
        }
      }
      vertical != null -> vertical
      horizontal != null -> horizontal
      else -> null
    }
  }

  private fun parseStop(token: String): RuneGradientStop? {
    val trimmed = token.trim()
    if (trimmed.isEmpty()) return null

    var splitIndex = -1
    var depth = 0
    for (i in trimmed.indices) {
      when (val c = trimmed[i]) {
        '(' -> depth++
        ')' -> if (depth > 0) depth--
        ' ', '\t' -> if (depth == 0) { splitIndex = i; break }
      }
    }

    val colorPart = if (splitIndex == -1) trimmed else trimmed.substring(0, splitIndex).trim()
    val positionPart = if (splitIndex == -1) null else trimmed.substring(splitIndex).trim()

    val color = RuneColorParser.parse(colorPart) ?: return null
    val position = positionPart?.let { parsePosition(it) }
    return RuneGradientStop(color, position)
  }

  private fun parsePosition(raw: String): Float? {
    val trimmed = raw.trim()
    if (trimmed.endsWith("%")) {
      val num = trimmed.removeSuffix("%").toFloatOrNull() ?: return null
      return (num / 100f).coerceIn(0f, 1f)
    }
    val num = trimmed.toFloatOrNull() ?: return null
    return if (abs(num) > 1f) {
      (num / 100f).coerceIn(0f, 1f)
    } else {
      num.coerceIn(0f, 1f)
    }
  }

  private fun splitArgs(raw: String): List<String> {
    val parts = mutableListOf<String>()
    val current = StringBuilder()
    var depth = 0
    for (c in raw) {
      when (c) {
        ',' -> {
          if (depth == 0) {
            parts.add(current.toString().trim())
            current.clear()
          } else {
            current.append(c)
          }
        }
        '(' -> {
          depth++
          current.append(c)
        }
        ')' -> {
          if (depth > 0) depth--
          current.append(c)
        }
        else -> current.append(c)
      }
    }
    if (current.isNotEmpty()) {
      parts.add(current.toString().trim())
    }
    return parts.filter { it.isNotEmpty() }
  }

  private fun normalizeAngle(angle: Float): Float {
    var a = angle % 360f
    if (a < 0f) a += 360f
    return a
  }
}
