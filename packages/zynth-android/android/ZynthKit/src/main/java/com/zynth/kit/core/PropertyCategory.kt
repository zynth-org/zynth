package com.zynth.kit.core

/**
 * Property categories for optimized property application.
 * Properties are categorized to enable:
 * - Fast O(1) dispatch instead of O(n) string comparisons
 * - Batched layout property application (reduce engine calls)
 * - Category-specific optimization strategies
 */
enum class PropertyCategory {
  /** Layout properties that affect Yoga layout engine (width, height, padding, margin, flex, etc.) */
  LAYOUT,
  
  /** Visual style properties applied to View (backgroundColor, borderRadius, borderColor, borderWidth, etc.) */
  STYLE,
  
  /** View-level properties (accessibility, pointerEvents, testID, etc.) */
  VIEW,
  
  /** Text-specific properties for TextViews (fontSize, color, fontWeight) */
  TEXT,
  
  /** TextInput component properties (placeholder, multiline, maxLength, etc.) */
  TEXT_INPUT,
  
  /** Pressable component properties (disabled, pressEffect, hitSlop, etc.) */
  PRESSABLE,

  /** Image component properties (source, resizeMode, etc.) */
  IMAGE,
  
  /** Unknown or unhandled property type */
  UNKNOWN
}

/**
 * Fast property categorization using pre-computed map.
 * This enables O(1) property lookup instead of O(n) when() dispatch.
 */
object PropertyCategoryMap {
  private val categoryMap: Map<String, PropertyCategory> = buildMap {
    // Layout properties (applied to Yoga engine)
    put("width", PropertyCategory.LAYOUT)
    put("height", PropertyCategory.LAYOUT)
    put("minWidth", PropertyCategory.LAYOUT)
    put("maxWidth", PropertyCategory.LAYOUT)
    put("minHeight", PropertyCategory.LAYOUT)
    put("maxHeight", PropertyCategory.LAYOUT)
    put("flex", PropertyCategory.LAYOUT)
    put("flexGrow", PropertyCategory.LAYOUT)
    put("flexShrink", PropertyCategory.LAYOUT)
    put("flexBasis", PropertyCategory.LAYOUT)
    put("flexDirection", PropertyCategory.LAYOUT)
    put("flexWrap", PropertyCategory.LAYOUT)
    put("justifyContent", PropertyCategory.LAYOUT)
    put("alignItems", PropertyCategory.LAYOUT)
    put("alignContent", PropertyCategory.LAYOUT)
    put("alignSelf", PropertyCategory.LAYOUT)
    put("aspectRatio", PropertyCategory.LAYOUT)
    put("overflow", PropertyCategory.LAYOUT)
    put("zIndex", PropertyCategory.STYLE)
    put("padding", PropertyCategory.LAYOUT)
    put("paddingHorizontal", PropertyCategory.LAYOUT)
    put("paddingVertical", PropertyCategory.LAYOUT)
    put("paddingLeft", PropertyCategory.LAYOUT)
    put("paddingRight", PropertyCategory.LAYOUT)
    put("paddingTop", PropertyCategory.LAYOUT)
    put("paddingBottom", PropertyCategory.LAYOUT)
    put("margin", PropertyCategory.LAYOUT)
    put("marginLeft", PropertyCategory.LAYOUT)
    put("marginRight", PropertyCategory.LAYOUT)
    put("marginTop", PropertyCategory.LAYOUT)
    put("marginBottom", PropertyCategory.LAYOUT)
    put("gap", PropertyCategory.LAYOUT)
    put("rowGap", PropertyCategory.LAYOUT)
    put("columnGap", PropertyCategory.LAYOUT)
    put("position", PropertyCategory.LAYOUT)
    put("top", PropertyCategory.LAYOUT)
    put("right", PropertyCategory.LAYOUT)
    put("bottom", PropertyCategory.LAYOUT)
    put("left", PropertyCategory.LAYOUT)
    put("display", PropertyCategory.LAYOUT)
    
    // Visual style properties (applied to View background/appearance)
    put("background", PropertyCategory.STYLE)
    put("backgroundImage", PropertyCategory.STYLE)
    put("backgroundColor", PropertyCategory.STYLE)
    put("borderRadius", PropertyCategory.STYLE)
    put("borderColor", PropertyCategory.STYLE)
    put("borderWidth", PropertyCategory.STYLE)
    put("borderStyle", PropertyCategory.STYLE)
    put("opacity", PropertyCategory.STYLE)
    put("boxShadow", PropertyCategory.STYLE)
    put("shadowColor", PropertyCategory.STYLE)
    put("shadowOffset", PropertyCategory.STYLE)
    put("shadowOpacity", PropertyCategory.STYLE)
    put("shadowRadius", PropertyCategory.STYLE)
    put("elevation", PropertyCategory.STYLE)
    
    // Text properties (applied to TextView)
    put("fontSize", PropertyCategory.TEXT)
    put("color", PropertyCategory.TEXT)
    put("fontWeight", PropertyCategory.TEXT)
    put("fontFamily", PropertyCategory.TEXT)
    put("fontStyle", PropertyCategory.TEXT)
    put("textAlign", PropertyCategory.TEXT)
    put("lineHeight", PropertyCategory.TEXT)
    put("lineSpacing", PropertyCategory.TEXT)
    put("paragraphSpacing", PropertyCategory.TEXT)
    put("letterSpacing", PropertyCategory.TEXT)
    put("textDecorationLine", PropertyCategory.TEXT)
    put("textTransform", PropertyCategory.TEXT)
    put("minimumFontScale", PropertyCategory.TEXT)
    put("baselineShift", PropertyCategory.TEXT)
    put("hyphenation", PropertyCategory.TEXT)
    
    // View-level properties
    put("accessibilityLabel", PropertyCategory.VIEW)
    put("accessibilityHint", PropertyCategory.VIEW)
    put("accessibilityRole", PropertyCategory.VIEW)
    put("testID", PropertyCategory.VIEW)
    put("pointerEvents", PropertyCategory.VIEW)
    put("layout", PropertyCategory.VIEW)
    
    // TextInput properties
    put("value", PropertyCategory.TEXT_INPUT)
    put("defaultValue", PropertyCategory.TEXT_INPUT)
    put("placeholder", PropertyCategory.TEXT_INPUT)
    put("multiline", PropertyCategory.TEXT_INPUT)
    put("numberOfLines", PropertyCategory.TEXT_INPUT)
    put("maxLength", PropertyCategory.TEXT_INPUT)
    put("editable", PropertyCategory.TEXT_INPUT)
    put("secureTextEntry", PropertyCategory.TEXT_INPUT)
    put("inputMode", PropertyCategory.TEXT_INPUT)
    put("autoCapitalize", PropertyCategory.TEXT_INPUT)
    put("autoCorrect", PropertyCategory.TEXT_INPUT)
    put("spellCheck", PropertyCategory.TEXT_INPUT)
    put("returnKeyType", PropertyCategory.TEXT_INPUT)
    put("blurOnSubmit", PropertyCategory.TEXT_INPUT)
    put("submitBehavior", PropertyCategory.TEXT_INPUT)
    put("selection", PropertyCategory.TEXT_INPUT)
    put("selectionColor", PropertyCategory.TEXT_INPUT)
    put("caretColor", PropertyCategory.TEXT_INPUT)
    put("eventThrottleMs", PropertyCategory.TEXT_INPUT)
    put("allowProgrammaticJumpDuringEdit", PropertyCategory.TEXT_INPUT)
    put("__focusRequest", PropertyCategory.TEXT_INPUT)
    put("clearButtonMode", PropertyCategory.TEXT_INPUT)
    put("showClearAccessory", PropertyCategory.TEXT_INPUT)
    
    // Pressable properties
    // Note: Some overlap with Button (disabled, pressEffect, etc.)
    // but we let component-specific handlers deal with that
    put("stateLayerStyle", PropertyCategory.PRESSABLE)
    put("delayPressInMs", PropertyCategory.PRESSABLE)
    put("delayPressOutMs", PropertyCategory.PRESSABLE)
    put("delayLongPressMs", PropertyCategory.PRESSABLE)
    put("longPressMinDurationMs", PropertyCategory.PRESSABLE)
    put("allowTouchPropagation", PropertyCategory.PRESSABLE)
    put("cancelOnOutside", PropertyCategory.PRESSABLE)
    put("enableDoublePress", PropertyCategory.PRESSABLE)
    put("doublePressWindowMs", PropertyCategory.PRESSABLE)
    put("focusable", PropertyCategory.PRESSABLE)
    put("activateKeys", PropertyCategory.PRESSABLE)
    put("__pressableCommand", PropertyCategory.PRESSABLE)
    
    // Image properties
    put("source", PropertyCategory.IMAGE)
    put("resizeMode", PropertyCategory.IMAGE)
    put("tintColor", PropertyCategory.IMAGE)
    put("fadeDuration", PropertyCategory.IMAGE)
  }
  
  /**
   * Get property category with O(1) lookup.
   * Returns UNKNOWN for unrecognized properties.
   */
  fun getCategory(propertyName: String): PropertyCategory {
    return categoryMap[propertyName] ?: PropertyCategory.UNKNOWN
  }
  
  /**
   * Check if a property is a layout property that should be batched.
   */
  fun isLayoutProperty(propertyName: String): Boolean {
    return categoryMap[propertyName] == PropertyCategory.LAYOUT
  }
  
  /**
   * Check if a property is a style property.
   */
  fun isStyleProperty(propertyName: String): Boolean {
    return categoryMap[propertyName] == PropertyCategory.STYLE
  }
}
