package com.rune.kit.layout

import android.util.Log
import org.json.JSONObject

data class Rect(val left: Int, val top: Int, val right: Int, val bottom: Int)

data class Style(
  val width: Float? = null,
  val height: Float? = null,
  val flex: Float? = null,
  val flexDirection: String? = null,
  val justifyContent: String? = null,
  val alignItems: String? = null,
  val margin: Float? = null,
  val marginTop: Float? = null,
  val marginBottom: Float? = null,
  val marginLeft: Float? = null,
  val marginRight: Float? = null,
  val padding: Float? = null,
  val paddingTop: Float? = null,
  val paddingBottom: Float? = null,
  val paddingLeft: Float? = null,
  val paddingRight: Float? = null,
  val paddingHorizontal: Float? = null,
  val paddingVertical: Float? = null,
  val backgroundColor: Int? = null,
  val borderRadius: Float? = null,
  val fontSize: Float? = null,
  val color: Int? = null,
  val fontWeight: String? = null,
) {
  companion object {
    fun fromJson(json: String): Style {
      if (json.isBlank()) return Style()
      return try {
        val obj = JSONObject(json)
        Style(
          width = obj.optDoubleOrNull("width")?.toFloat(),
          height = obj.optDoubleOrNull("height")?.toFloat(),
          flex = obj.optDoubleOrNull("flex")?.toFloat(),
          flexDirection = obj.optStringOrNull("flexDirection"),
          justifyContent = obj.optStringOrNull("justifyContent"),
          alignItems = obj.optStringOrNull("alignItems"),
          margin = obj.optDoubleOrNull("margin")?.toFloat(),
          marginTop = obj.optDoubleOrNull("marginTop")?.toFloat(),
          marginBottom = obj.optDoubleOrNull("marginBottom")?.toFloat(),
          marginLeft = obj.optDoubleOrNull("marginLeft")?.toFloat(),
          marginRight = obj.optDoubleOrNull("marginRight")?.toFloat(),
          padding = obj.optDoubleOrNull("padding")?.toFloat(),
          paddingTop = obj.optDoubleOrNull("paddingTop")?.toFloat(),
          paddingBottom = obj.optDoubleOrNull("paddingBottom")?.toFloat(),
          paddingLeft = obj.optDoubleOrNull("paddingLeft")?.toFloat(),
          paddingRight = obj.optDoubleOrNull("paddingRight")?.toFloat(),
          paddingHorizontal = obj.optDoubleOrNull("paddingHorizontal")?.toFloat(),
          paddingVertical = obj.optDoubleOrNull("paddingVertical")?.toFloat(),
          backgroundColor = obj.optColor("backgroundColor"),
          borderRadius = obj.optDoubleOrNull("borderRadius")?.toFloat(),
          fontSize = obj.optDoubleOrNull("fontSize")?.toFloat(),
          color = obj.optColor("color"),
          fontWeight = obj.optStringOrNull("fontWeight"),
        )
      } catch (t: Throwable) {
        Log.w("RuneStyle", "Failed to parse style JSON: ${t.message ?: t}")
        Style()
      }
    }
  }
}

interface LayoutEngine {
  fun createNode(id: Int)
  fun removeNode(id: Int)
  fun insertChild(parent: Int, child: Int, index: Int)
  fun setStyle(id: Int, style: Style)
  fun calculateLayout(width: Int, height: Int)
  fun frame(id: Int): Rect
  fun setMeasureHandler(id: Int, handler: MeasureHandler?)
}

object StyleParser

private fun JSONObject.optDoubleOrNull(name: String): Double? =
  if (has(name) && !isNull(name)) optDouble(name) else null

private fun JSONObject.optStringOrNull(name: String): String? =
  if (has(name) && !isNull(name)) optString(name) else null

private fun JSONObject.optColor(name: String): Int? {
  if (!has(name) || isNull(name)) return null
  val value = get(name)
  return when (value) {
    is Number -> value.toInt()
    is String -> runCatching { android.graphics.Color.parseColor(value) }.getOrNull()
    else -> null
  }
}

enum class MeasureMode { UNDEFINED, EXACTLY, AT_MOST }

data class MeasureInput(
  val width: Float,
  val widthMode: MeasureMode,
  val height: Float,
  val heightMode: MeasureMode,
)

typealias MeasureHandler = (MeasureInput) -> Pair<Float, Float>
