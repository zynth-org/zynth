package com.rune.kit.core

import com.rune.kit.layout.Style

data class TextStyleAttributes(
  val color: Int? = null,
  val fontSize: Float? = null,
  val fontFamily: String? = null,
  val fontWeight: String? = null,
  val fontStyle: String? = null,
  val textAlign: String? = null,
  val letterSpacing: Float? = null,
  val lineHeight: Float? = null,
  val lineSpacing: Float? = null,
  val paragraphSpacing: Float? = null,
  val textDecorationLine: String? = null,
  val textTransform: String? = null,
  val baselineShift: Float? = null,
  val minimumFontScale: Float? = null,
  val hyphenation: String? = null,
) {
  fun mergeWith(parent: TextStyleAttributes?): TextStyleAttributes {
    if (parent == null) return this
    return TextStyleAttributes(
      color = color ?: parent.color,
      fontSize = fontSize ?: parent.fontSize,
      fontFamily = fontFamily ?: parent.fontFamily,
      fontWeight = fontWeight ?: parent.fontWeight,
      fontStyle = fontStyle ?: parent.fontStyle,
      textAlign = textAlign ?: parent.textAlign,
      letterSpacing = letterSpacing ?: parent.letterSpacing,
      lineHeight = lineHeight ?: parent.lineHeight,
      lineSpacing = lineSpacing ?: parent.lineSpacing,
      paragraphSpacing = paragraphSpacing ?: parent.paragraphSpacing,
      textDecorationLine = textDecorationLine ?: parent.textDecorationLine,
      textTransform = textTransform ?: parent.textTransform,
      baselineShift = baselineShift ?: parent.baselineShift,
      minimumFontScale = minimumFontScale ?: parent.minimumFontScale,
      hyphenation = hyphenation ?: parent.hyphenation,
    )
  }

  companion object {
    fun fromStyle(style: Style): TextStyleAttributes {
      return TextStyleAttributes(
        color = style.color,
        fontSize = style.fontSize,
        fontFamily = style.fontFamily,
        fontWeight = style.fontWeight,
        fontStyle = style.fontStyle,
        textAlign = style.textAlign,
        letterSpacing = style.letterSpacing,
        lineHeight = style.lineHeight,
        lineSpacing = style.lineSpacing,
        paragraphSpacing = style.paragraphSpacing,
        textDecorationLine = style.textDecorationLine,
        textTransform = style.textTransform,
        baselineShift = style.baselineShift,
        minimumFontScale = style.minimumFontScale,
        hyphenation = style.hyphenation,
      )
    }
  }
}
