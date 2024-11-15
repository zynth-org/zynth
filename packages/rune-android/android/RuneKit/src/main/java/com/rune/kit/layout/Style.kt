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
  val flex: Float? = null,
  val flexDirection: String? = null,
  val justifyContent: String? = null,
  val alignItems: String? = null,
  val alignSelf: String? = null,
  
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
  
  // Visual properties
  val backgroundColor: Int? = null,
  val borderRadius: Float? = null,
  
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
        // Support width/height as numbers or percentage strings (e.g., "100%")
  val rawWidth = json.opt("width")
        val (width, widthPct) = when (rawWidth) {
          is Number -> rawWidth.toFloat() to null
          is String -> parseDimensionPercent(rawWidth)
          else -> null to null
        }
  val rawHeight = json.opt("height")
        val (height, heightPct) = when (rawHeight) {
          is Number -> rawHeight.toFloat() to null
          is String -> parseDimensionPercent(rawHeight)
          else -> null to null
        }
        return Style(
          width = width,
          height = height,
          widthPercent = widthPct,
          heightPercent = heightPct,
          flex = json.optFloat("flex"),
          flexDirection = json.optStringOrNull("flexDirection"),
          justifyContent = json.optStringOrNull("justifyContent"),
          alignItems = json.optStringOrNull("alignItems"),
          alignSelf = json.optStringOrNull("alignSelf"),
          
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
          
          backgroundColor = json.optString("backgroundColor")?.let { parseColor(it) },
          borderRadius = json.optFloat("borderRadius"),
          
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
}