package com.rune.kit.layout

import com.rune.kit.core.RuneColorParser
import com.rune.kit.core.RuneGradientParser
import com.rune.kit.core.RuneLinearGradient
import com.rune.kit.core.RuneShadowParser
import com.rune.kit.core.ShadowLayer
import com.rune.kit.core.RuneTransformParser
import com.rune.kit.core.TransformOperation
import com.facebook.yoga.YogaAlign
import com.facebook.yoga.YogaFlexDirection
import com.facebook.yoga.YogaJustify
import org.json.JSONArray
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
  val flexBasis: Float? = null,
  val flexBasisPercent: Float? = null,
  val flexBasisAuto: Boolean = false,
  val flexDirection: String? = null,
  val flexWrap: String? = null,
  val justifyContent: String? = null,
  val alignItems: String? = null,
  val alignContent: String? = null,
  val alignSelf: String? = null,
  val aspectRatio: Float? = null,
  val overflow: String? = null,
  val zIndex: Float? = null,
  
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
  val backgroundGradient: RuneLinearGradient? = null,
  val borderColor: Int? = null,
  val borderTopColor: Int? = null,
  val borderRightColor: Int? = null,
  val borderBottomColor: Int? = null,
  val borderLeftColor: Int? = null,
  val borderWidth: Float? = null,
  val borderTopWidth: Float? = null,
  val borderRightWidth: Float? = null,
  val borderBottomWidth: Float? = null,
  val borderLeftWidth: Float? = null,
  val borderStyle: String? = null,
  val borderRadius: Float? = null,
  val borderTopLeftRadius: Float? = null,
  val borderTopRightRadius: Float? = null,
  val borderBottomRightRadius: Float? = null,
  val borderBottomLeftRadius: Float? = null,
  val boxShadow: List<ShadowLayer>? = null,
  val shadowColor: Int? = null,
  val shadowOpacity: Float? = null,
  val shadowOffsetX: Float? = null,
  val shadowOffsetY: Float? = null,
  val shadowRadius: Float? = null,
  val elevation: Float? = null,
  val opacity: Float? = null,
  
  // Text properties
  val fontSize: Float? = null,
  val color: Int? = null,
  val fontWeight: String? = null,
  val fontFamily: String? = null,
  val fontStyle: String? = null,
  val textAlign: String? = null,
  val lineHeight: Float? = null,
  val lineSpacing: Float? = null,
  val paragraphSpacing: Float? = null,
  val letterSpacing: Float? = null,
  val textDecorationLine: String? = null,
  val textTransform: String? = null,
  val minimumFontScale: Float? = null,
  val baselineShift: Float? = null,
  val hyphenation: String? = null,
  
  // Transform properties
  val transform: List<TransformOperation>? = null,
  val transformOrigin: TransformOrigin? = null,
) {
  
  enum class FlexDirection {
    COLUMN,
    ROW,
    ROW_REVERSE,
    COLUMN_REVERSE;
    
    fun toFlexDirection(): YogaFlexDirection = when (this) {
      COLUMN -> YogaFlexDirection.COLUMN
      ROW -> YogaFlexDirection.ROW
      ROW_REVERSE -> YogaFlexDirection.ROW_REVERSE
      COLUMN_REVERSE -> YogaFlexDirection.COLUMN_REVERSE
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
        
        // Flex basis can be auto, number or percent
        val rawFlexBasis = json.opt("flexBasis")
        val flexBasisResult = when (rawFlexBasis) {
          is Number -> Triple(rawFlexBasis.toFloat(), null, false)
          is String -> {
            if (rawFlexBasis.equals("auto", ignoreCase = true)) {
              Triple(null, null, true)
            } else {
              val (value, percent) = parseDimensionPercent(rawFlexBasis)
              Triple(value, percent, false)
            }
          }
          else -> Triple(null, null, false)
        }

        var backgroundColor = json.optStringOrNull("backgroundColor")?.let { parseColor(it) }
        val backgroundValue = json.opt("background") ?: json.opt("backgroundImage")
        val backgroundGradient = RuneGradientParser.parse(backgroundValue)
        if (backgroundColor == null && backgroundGradient == null && backgroundValue is String) {
          backgroundColor = parseColor(backgroundValue)
        }
        val fontFamily = json.optStringOrNull("fontFamily")
        val fontStyle = json.optStringOrNull("fontStyle")
        val textAlign = json.optStringOrNull("textAlign")
        val lineHeight = json.optFloat("lineHeight")
        val lineSpacing = json.optFloat("lineSpacing")
        val paragraphSpacing = json.optFloat("paragraphSpacing")
        val letterSpacing = json.optFloat("letterSpacing")
        val textDecorationLine = json.optStringOrNull("textDecorationLine")
        val textTransform = json.optStringOrNull("textTransform")
        val minimumFontScale = json.optFloat("minimumFontScale")
        val baselineShift = json.optFloat("baselineShift")
        val hyphenation = json.optStringOrNull("hyphenation")

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
          flexBasis = flexBasisResult.first,
          flexBasisPercent = flexBasisResult.second,
          flexBasisAuto = flexBasisResult.third,
          flexDirection = json.optStringOrNull("flexDirection"),
          flexWrap = json.optStringOrNull("flexWrap"),
          justifyContent = json.optStringOrNull("justifyContent"),
          alignItems = json.optStringOrNull("alignItems"),
          alignContent = json.optStringOrNull("alignContent"),
          alignSelf = json.optStringOrNull("alignSelf"),
          aspectRatio = json.optFloat("aspectRatio"),
          overflow = json.optStringOrNull("overflow"),
          zIndex = json.optFloat("zIndex"),
          
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
          
          backgroundColor = backgroundColor,
          backgroundGradient = backgroundGradient,
          borderRadius = json.optFloat("borderRadius"),
          borderColor = json.optStringOrNull("borderColor")?.let { parseColor(it) },
          borderTopColor = json.optStringOrNull("borderTopColor")?.let { parseColor(it) },
          borderRightColor = json.optStringOrNull("borderRightColor")?.let { parseColor(it) },
          borderBottomColor = json.optStringOrNull("borderBottomColor")?.let { parseColor(it) },
          borderLeftColor = json.optStringOrNull("borderLeftColor")?.let { parseColor(it) },
          borderWidth = json.optFloat("borderWidth"),
          borderTopWidth = json.optFloat("borderTopWidth"),
          borderRightWidth = json.optFloat("borderRightWidth"),
          borderBottomWidth = json.optFloat("borderBottomWidth"),
          borderLeftWidth = json.optFloat("borderLeftWidth"),
          borderStyle = json.optStringOrNull("borderStyle")?.lowercase(),
          boxShadow = RuneShadowParser.merge(
            RuneShadowParser.parse(json.opt("boxShadow")),
            RuneShadowParser.fromReactNative(
              shadowColor = json.optStringOrNull("shadowColor")?.let { parseColor(it) },
              shadowOpacity = json.optFloat("shadowOpacity"),
              shadowRadius = json.optFloat("shadowRadius"),
              offsetX = json.optJSONObject("shadowOffset")?.optFloat("width"),
              offsetY = json.optJSONObject("shadowOffset")?.optFloat("height"),
            ),
          ),
          shadowColor = json.optString("shadowColor")?.let { parseColor(it) },
          shadowOpacity = json.optFloat("shadowOpacity")?.coerceIn(0f, 1f),
          shadowOffsetX = json.optJSONObject("shadowOffset")?.optFloat("width"),
          shadowOffsetY = json.optJSONObject("shadowOffset")?.optFloat("height"),
          shadowRadius = json.optFloat("shadowRadius"),
          elevation = json.optFloat("elevation"),
          opacity = json.optFloat("opacity")?.coerceIn(0f, 1f),
          borderTopLeftRadius = json.optFloat("borderTopLeftRadius"),
          borderTopRightRadius = json.optFloat("borderTopRightRadius"),
          borderBottomRightRadius = json.optFloat("borderBottomRightRadius"),
          borderBottomLeftRadius = json.optFloat("borderBottomLeftRadius"),
          
          fontSize = json.optFloat("fontSize"),
          color = json.optString("color")?.let { parseColor(it) },
          fontWeight = json.optStringOrNull("fontWeight"),
          fontFamily = fontFamily,
          fontStyle = fontStyle,
          textAlign = textAlign,
          lineHeight = lineHeight,
          lineSpacing = lineSpacing,
          paragraphSpacing = paragraphSpacing,
          letterSpacing = letterSpacing,
          textDecorationLine = textDecorationLine,
          textTransform = textTransform,
          minimumFontScale = minimumFontScale,
          baselineShift = baselineShift,
          hyphenation = hyphenation,
          
          transform = RuneTransformParser.parse(json.opt("transform")),
          transformOrigin = parseTransformOrigin(json.opt("transformOrigin")),
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
        "row-reverse", "row_reverse" -> FlexDirection.ROW_REVERSE
        "column-reverse", "column_reverse" -> FlexDirection.COLUMN_REVERSE
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
     * Parse color from various formats using RuneColorParser.
     */
    private fun parseColor(colorString: String): Int? {
      return RuneColorParser.parse(colorString)
    }
  }

    fun toPixels(density: Float): Style {
      if (density == 1f) return this
      fun Float?.scale(): Float? = this?.times(density)
      return copy(
        flexGrow = flexGrow,
        flexShrink = flexShrink,
        flexBasis = flexBasis.scale(),
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
      borderTopLeftRadius = borderTopLeftRadius.scale(),
      borderTopRightRadius = borderTopRightRadius.scale(),
      borderBottomRightRadius = borderBottomRightRadius.scale(),
      borderBottomLeftRadius = borderBottomLeftRadius.scale(),
      borderWidth = borderWidth.scale(),
      borderTopWidth = borderTopWidth.scale(),
      borderRightWidth = borderRightWidth.scale(),
      borderBottomWidth = borderBottomWidth.scale(),
      borderLeftWidth = borderLeftWidth.scale(),
      boxShadow = boxShadow?.map { it.scale(density) },
      shadowOffsetX = shadowOffsetX.scale(),
      shadowOffsetY = shadowOffsetY.scale(),
      shadowRadius = shadowRadius.scale(),
      elevation = elevation.scale(),
      fontSize = fontSize.scale(),
      lineHeight = lineHeight.scale(),
      lineSpacing = lineSpacing.scale(),
      paragraphSpacing = paragraphSpacing.scale(),
      letterSpacing = letterSpacing.scale(),
      baselineShift = baselineShift.scale(),
      transform = transform?.map { op ->
        when (op) {
          is TransformOperation.Translate -> TransformOperation.Translate(
            op.x * density,
            op.y * density
          )
          is TransformOperation.Perspective -> TransformOperation.Perspective(
            op.value * density
          )
          else -> op
        }
      },
      transformOrigin = transformOrigin?.toPixels(density),
    )
  }
}

data class TransformOriginValue(val value: Float, val isPercent: Boolean) {
  fun resolve(size: Int): Float {
    val clamped = if (size < 0) 0 else size
    return if (isPercent) clamped * value else value
  }

  fun toPixels(density: Float): TransformOriginValue {
    return if (isPercent) this else TransformOriginValue(value * density, false)
  }
}

data class TransformOrigin(
  val x: TransformOriginValue,
  val y: TransformOriginValue,
) {
  fun toPixels(density: Float): TransformOrigin {
    return TransformOrigin(
      x = x.toPixels(density),
      y = y.toPixels(density),
    )
  }
}

private enum class OriginAxis {
  X,
  Y,
}

private fun parseTransformOrigin(raw: Any?): TransformOrigin? {
  if (raw == null || raw == JSONObject.NULL) return null
  return when (raw) {
    is JSONArray -> {
      val x = parseOriginValue(raw.opt(0), OriginAxis.X) ?: TransformOriginValue(0.5f, true)
      val y = parseOriginValue(raw.opt(1), OriginAxis.Y) ?: TransformOriginValue(0.5f, true)
      TransformOrigin(x, y)
    }
    is String -> parseTransformOriginString(raw)
    else -> null
  }
}

private fun parseTransformOriginString(raw: String): TransformOrigin? {
  val tokens = raw.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
  if (tokens.isEmpty()) return null
  if (tokens.size == 1) {
    val x = parseOriginToken(tokens[0], OriginAxis.X) ?: TransformOriginValue(0.5f, true)
    val y = TransformOriginValue(0.5f, true)
    return TransformOrigin(x, y)
  }
  val first = tokens[0]
  val second = tokens[1]
  val xDirect = parseOriginToken(first, OriginAxis.X)
  val yDirect = parseOriginToken(second, OriginAxis.Y)
  if (xDirect != null && yDirect != null) {
    return TransformOrigin(xDirect, yDirect)
  }
  val xSwap = parseOriginToken(second, OriginAxis.X)
  val ySwap = parseOriginToken(first, OriginAxis.Y)
  if (xSwap != null && ySwap != null) {
    return TransformOrigin(xSwap, ySwap)
  }
  return TransformOrigin(
    x = xDirect ?: TransformOriginValue(0.5f, true),
    y = yDirect ?: TransformOriginValue(0.5f, true),
  )
}

private fun parseOriginValue(raw: Any?, axis: OriginAxis): TransformOriginValue? {
  return when (raw) {
    is Number -> TransformOriginValue(raw.toFloat(), false)
    is String -> parseOriginToken(raw, axis)
    else -> null
  }
}

private fun parseOriginToken(token: String, axis: OriginAxis): TransformOriginValue? {
  val value = token.trim().lowercase()
  when (value) {
    "center" -> return TransformOriginValue(0.5f, true)
  }
  if (axis == OriginAxis.X) {
    when (value) {
      "left" -> return TransformOriginValue(0f, true)
      "right" -> return TransformOriginValue(1f, true)
    }
  } else {
    when (value) {
      "top" -> return TransformOriginValue(0f, true)
      "bottom" -> return TransformOriginValue(1f, true)
    }
  }
  if (value.endsWith("%")) {
    val number = value.removeSuffix("%").toFloatOrNull() ?: return null
    return TransformOriginValue(number / 100f, true)
  }
  if (value.endsWith("px")) {
    val number = value.removeSuffix("px").toFloatOrNull() ?: return null
    return TransformOriginValue(number, false)
  }
  val number = value.toFloatOrNull() ?: return null
  return TransformOriginValue(number, false)
}
