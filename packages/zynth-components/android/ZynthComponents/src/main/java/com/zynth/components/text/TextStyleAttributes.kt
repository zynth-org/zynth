package com.zynth.components.text

import com.zynth.kit.layout.Style

data class TextStyleAttributes(
  val fontSize: Float? = null,
  val fontWeight: String? = null,
  val fontFamily: String? = null,
  val fontStyle: String? = null,
  val color: Int? = null,
  val lineHeight: Float? = null,
  val lineSpacing: Float? = null,
  val paragraphSpacing: Float? = null,
  val letterSpacing: Float? = null,
  val textDecorationLine: String? = null,
  val textTransform: String? = null,
  val minimumFontScale: Float? = null,
  val baselineShift: Float? = null,
  val hyphenation: String? = null,
) {
  fun mergeWith(parent: TextStyleAttributes?): TextStyleAttributes {
    if (parent == null) return this
    return TextStyleAttributes(
      fontSize = fontSize ?: parent.fontSize,
      fontWeight = fontWeight ?: parent.fontWeight,
      fontFamily = fontFamily ?: parent.fontFamily,
      fontStyle = fontStyle ?: parent.fontStyle,
      color = color ?: parent.color,
      lineHeight = lineHeight ?: parent.lineHeight,
      lineSpacing = lineSpacing ?: parent.lineSpacing,
      paragraphSpacing = paragraphSpacing ?: parent.paragraphSpacing,
      letterSpacing = letterSpacing ?: parent.letterSpacing,
      textDecorationLine = textDecorationLine ?: parent.textDecorationLine,
      textTransform = textTransform ?: parent.textTransform,
      minimumFontScale = minimumFontScale ?: parent.minimumFontScale,
      baselineShift = baselineShift ?: parent.baselineShift,
      hyphenation = hyphenation ?: parent.hyphenation,
    )
  }

  companion object {
    fun fromStyle(style: Style): TextStyleAttributes {
      return TextStyleAttributes(
        fontSize = style.fontSize,
        fontWeight = style.fontWeight,
        fontFamily = style.fontFamily,
        fontStyle = style.fontStyle,
        color = style.color,
        lineHeight = style.lineHeight,
        lineSpacing = style.lineSpacing,
        paragraphSpacing = style.paragraphSpacing,
        letterSpacing = style.letterSpacing,
        textDecorationLine = style.textDecorationLine,
        textTransform = style.textTransform,
        minimumFontScale = style.minimumFontScale,
        baselineShift = style.baselineShift,
        hyphenation = style.hyphenation,
      )
    }
  }
}
