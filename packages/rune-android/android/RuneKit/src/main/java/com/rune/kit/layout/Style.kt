package com.rune.kit.layout

import android.graphics.Color
import com.facebook.yoga.YogaAlign
import com.facebook.yoga.YogaFlexDirection
import com.facebook.yoga.YogaJustify
import org.json.JSONObject
import org.json.JSONException

/**
 * Style class representing CSS-like properties that can be applied to Yoga layout nodes.
 * Supports parsing from JSON for property values sent from JavaScript.
 */
data class Style(
  // Layout properties
  val width: Float? = null,
  val height: Float? = null,
  val widthPercent: Float? = null,
  val heightPercent: Float? = null,
  val widthAuto: Boolean = false,
  val heightAuto: Boolean = false,
  val minWidth: Float? = null,
  val minWidthPercent: Float? = null,
  val maxWidth: Float? = null,
  val maxWidthPercent: Float? = null,
  val minHeight: Float? = null,
  val minHeightPercent: Float? = null,
  val maxHeight: Float? = null,
  val maxHeightPercent: Float? = null,
  val flex: Float? = null,
  val flexGrow: Float? = null,
  val flexShrink: Float? = null,
  val flexDirection: String? = null,
  val justifyContent: String? = null,
  val alignItems: String? = null,
  val alignSelf: String? = null,
  
  // Position properties
  val position: String? = null,
  val top: Float? = null,
  val right: Float? = null,
  val bottom: Float? = null,
  val left: Float? = null,
  val display: String? = null,
  
  // Spacing properties
  val padding: Float? = null,
  val paddingHorizontal: Float? = null,
  val paddingVertical: Float? = null,
  val paddingLeft: Float? = null,
  val paddingRight: Float? = null,
  val paddingTop: Float? = null,
  val paddingBottom: Float? = null,
  
  val margin: Float? = null,
  val marginLeft: Float? = null,
  val marginRight: Float? = null,
  val marginTop: Float? = null,
  val marginBottom: Float? = null,
  val gap: Float? = null,
  val rowGap: Float? = null,
  val columnGap: Float? = null,
  
  // Visual properties
  val backgroundColor: Int? = null,
  val borderRadius: Float? = null,
  val borderColor: Int? = null,
  val borderWidth: Float? = null,
  val borderStyle: String? = null,
  val opacity: Float? = null,
  
  // Text properties
  val fontSize: Float? = null,
  val color: Int? = null,
  val fontWeight: String? = null,
) {
  
  enum class FlexDirection {
    COLUMN, ROW;
    
    fun toFlexDirection(): YogaFlexDirection = when (this) {
      COLUMN -> YogaFlexDirection.COLUMN
      ROW -> YogaFlexDirection.ROW
    }
  }
  
  enum class JustifyContent {
    FLEX_START, FLEX_END, CENTER, SPACE_BETWEEN, SPACE_AROUND;
    
    fun toJustify(): YogaJustify = when (this) {
      FLEX_START -> YogaJustify.FLEX_START
      FLEX_END -> YogaJustify.FLEX_END
      CENTER -> YogaJustify.CENTER
      SPACE_BETWEEN -> YogaJustify.SPACE_BETWEEN
      SPACE_AROUND -> YogaJustify.SPACE_AROUND
    }
  }
  
  enum class AlignItems {
    STRETCH, FLEX_START, FLEX_END, CENTER;
    
    fun toAlignItems(): YogaAlign = when (this) {
      STRETCH -> YogaAlign.STRETCH
      FLEX_START -> YogaAlign.FLEX_START
      FLEX_END -> YogaAlign.FLEX_END
      CENTER -> YogaAlign.CENTER
    }
  }
  
  companion object {
    /**
     * Parse style properties from JSON string.
     * Handles both primitive values and nested objects.
     */
    fun fromJson(jsonString: String): Style {
      try {
        val json = JSONObject(jsonString)
        // Support width/height as numbers, percentages, or "auto"
        val rawWidth = json.opt("width")
        val widthResult = when (rawWidth) {
          is Number -> Triple(rawWidth.toFloat(), null, false)
          is String -> {
            if (rawWidth.equals("auto", ignoreCase = true)) {
              Triple(null, null, true)
            } else {
              val (value, percent) = parseDimensionPercent(rawWidth)
              Triple(value, percent, false)
            }
          }
          else -> Triple(null, null, false)
        }
        val rawHeight = json.opt("height")
        val heightResult = when (rawHeight) {
          is Number -> Triple(rawHeight.toFloat(), null, false)
          is String -> {
            if (rawHeight.equals("auto", ignoreCase = true)) {
              Triple(null, null, true)
            } else {
              val (value, percent) = parseDimensionPercent(rawHeight)
              Triple(value, percent, false)
            }
          }
          else -> Triple(null, null, false)
        }
        val (minWidthValue, minWidthPercent) = json.optDimensionWithPercent("minWidth")
        val (maxWidthValue, maxWidthPercent) = json.optDimensionWithPercent("maxWidth")
        val (minHeightValue, minHeightPercent) = json.optDimensionWithPercent("minHeight")
        val (maxHeightValue, maxHeightPercent) = json.optDimensionWithPercent("maxHeight")
        return Style(
          width = widthResult.first,
          height = heightResult.first,
          widthPercent = widthResult.second,
          heightPercent = heightResult.second,
          widthAuto = widthResult.third,
          heightAuto = heightResult.third,
          minWidth = minWidthValue,
          minWidthPercent = minWidthPercent,
          maxWidth = maxWidthValue,
          maxWidthPercent = maxWidthPercent,
          minHeight = minHeightValue,
          minHeightPercent = minHeightPercent,
          maxHeight = maxHeightValue,
          maxHeightPercent = maxHeightPercent,
          flex = json.optFloat("flex"),
          flexGrow = json.optFloat("flexGrow"),
          flexShrink = json.optFloat("flexShrink"),
          flexDirection = json.optStringOrNull("flexDirection"),
          justifyContent = json.optStringOrNull("justifyContent"),
          alignItems = json.optStringOrNull("alignItems"),
          alignSelf = json.optStringOrNull("alignSelf"),
          
          position = json.optStringOrNull("position"),
          top = json.optFloat("top"),
          right = json.optFloat("right"),
          bottom = json.optFloat("bottom"),
          left = json.optFloat("left"),
          display = json.optStringOrNull("display"),
          
          padding = json.optFloat("padding"),
          paddingHorizontal = json.optFloat("paddingHorizontal"),
          paddingVertical = json.optFloat("paddingVertical"),
          paddingLeft = json.optFloat("paddingLeft"),
          paddingRight = json.optFloat("paddingRight"),
          paddingTop = json.optFloat("paddingTop"),
          paddingBottom = json.optFloat("paddingBottom"),
          
          margin = json.optFloat("margin"),
          marginLeft = json.optFloat("marginLeft"),
          marginRight = json.optFloat("marginRight"),
          marginTop = json.optFloat("marginTop"),
          marginBottom = json.optFloat("marginBottom"),
          gap = json.optFloat("gap"),
          rowGap = json.optFloat("rowGap"),
          columnGap = json.optFloat("columnGap"),
          
          backgroundColor = json.optString("backgroundColor")?.let { parseColor(it) },
          borderRadius = json.optFloat("borderRadius"),
          borderColor = json.optString("borderColor")?.let { parseColor(it) },
          borderWidth = json.optFloat("borderWidth"),
          borderStyle = json.optStringOrNull("borderStyle")?.lowercase(),
          opacity = json.optFloat("opacity")?.coerceIn(0f, 1f),
          
          fontSize = json.optFloat("fontSize"),
          color = json.optString("color")?.let { parseColor(it) },
          fontWeight = json.optStringOrNull("fontWeight"),
        )
      } catch (e: JSONException) {
        // Return empty style if parsing fails
        return Style()
      }
    }
    
    private fun JSONObject.optFloat(name: String): Float? {
      return if (has(name) && !isNull(name)) {
        val value = opt(name)
        when (value) {
          is Number -> value.toFloat()
          is String -> value.toFloatOrNull()
          else -> null
        }
      } else null
    }
    
    private fun parseFlexDirection(value: String): FlexDirection? {
      return when (value.lowercase()) {
        "column" -> FlexDirection.COLUMN
        "row" -> FlexDirection.ROW
        else -> null
      }
    }
    
    private fun parseJustifyContent(value: String): JustifyContent? {
      return when (value.lowercase().replace("-", "_")) {
        "flex_start", "flexstart" -> JustifyContent.FLEX_START
        "flex_end", "flexend" -> JustifyContent.FLEX_END
        "center" -> JustifyContent.CENTER
        "space_between", "spacebetween" -> JustifyContent.SPACE_BETWEEN
        "space_around", "spacearound" -> JustifyContent.SPACE_AROUND
        else -> null
      }
    }
    
    private fun parseAlignItems(value: String): AlignItems? {
      return when (value.lowercase().replace("-", "_")) {
        "stretch" -> AlignItems.STRETCH
        "flex_start", "flexstart" -> AlignItems.FLEX_START
        "flex_end", "flexend" -> AlignItems.FLEX_END
        "center" -> AlignItems.CENTER
        else -> null
      }
    }
    
    private fun parseDimensionPercent(raw: String): Pair<Float?, Float?> {
      val s = raw.trim()
      return if (s.endsWith("%")) {
        val number = s.removeSuffix("%").toFloatOrNull()
        if (number != null) null to number else null to null
      } else {
        s.toFloatOrNull() to null
      }
    }

    private fun JSONObject.optDimensionWithPercent(name: String): Pair<Float?, Float?> {
      if (!has(name) || isNull(name)) return null to null
      return when (val value = opt(name)) {
        is Number -> value.toFloat() to null
        is String -> {
          val (absolute, percent) = parseDimensionPercent(value)
          absolute to percent
        }
        else -> null to null
      }
    }

    private fun JSONObject.optStringOrNull(name: String): String? {
      return if (has(name) && !isNull(name)) {
        val s = optString(name)
        if (s.isBlank()) null else s
      } else null
    }
    
    /**
     * Parse color from various formats:
     * - Hex: "#FF0000", "#F00"
     * - Named colors: "red", "blue", "white", etc.
     * - RGB: "rgb(255, 0, 0)"
     * - RGBA: "rgba(255, 0, 0, 0.5)"
     */
    private fun parseColor(colorString: String): Int? {
      try {
        val color = colorString.trim()
        
        // Handle hex colors
        if (color.startsWith("#")) {
          return Color.parseColor(color)
        }
        
        // Handle named colors
        return when (color.lowercase()) {
          "transparent" -> Color.TRANSPARENT
          "black" -> Color.BLACK
          "white" -> Color.WHITE
          "red" -> Color.RED
          "green" -> Color.GREEN
          "blue" -> Color.BLUE
          "yellow" -> Color.YELLOW
          "cyan" -> Color.CYAN
          "magenta" -> Color.MAGENTA
          "gray", "grey" -> Color.GRAY
          "darkgray", "darkgrey" -> Color.DKGRAY
          "lightgray", "lightgrey" -> Color.LTGRAY
          else -> {
            // Try to parse as hex color without #
            if (color.matches(Regex("[0-9a-fA-F]{6}|[0-9a-fA-F]{3}"))) {
              Color.parseColor("#$color")
            } else {
              // TODO: Add RGB/RGBA parsing if needed
              null
            }
          }
        }
      } catch (e: IllegalArgumentException) {
        return null
      }
    }
  }

  fun toPixels(density: Float): Style {
    if (density == 1f) return this
    fun Float?.scale(): Float? = this?.times(density)
    return copy(
      width = width.scale(),
      height = height.scale(),
      minWidth = minWidth.scale(),
      maxWidth = maxWidth.scale(),
      minHeight = minHeight.scale(),
      maxHeight = maxHeight.scale(),
      top = top.scale(),
      right = right.scale(),
      bottom = bottom.scale(),
      left = left.scale(),
      padding = padding.scale(),
      paddingHorizontal = paddingHorizontal.scale(),
      paddingVertical = paddingVertical.scale(),
      paddingLeft = paddingLeft.scale(),
      paddingRight = paddingRight.scale(),
      paddingTop = paddingTop.scale(),
      paddingBottom = paddingBottom.scale(),
      margin = margin.scale(),
      marginLeft = marginLeft.scale(),
      marginRight = marginRight.scale(),
      marginTop = marginTop.scale(),
      marginBottom = marginBottom.scale(),
      gap = gap.scale(),
      rowGap = rowGap.scale(),
      columnGap = columnGap.scale(),
      borderRadius = borderRadius.scale(),
      borderWidth = borderWidth.scale(),
      fontSize = fontSize.scale(),
    )
  }
}
