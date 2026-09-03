package com.zynth.kit.core

import android.os.Build
import android.text.SpannableString
import android.text.style.StrikethroughSpan
import android.text.style.UnderlineSpan
import android.widget.TextView

internal data class ZynthTextStyleState(
  var rawText: String = "",
  var lineHeight: Float? = null,
  var lineSpacing: Float? = null,
  var paragraphSpacing: Float? = null,
  var baselineShift: Float? = null,
  var letterSpacing: Float? = null,
  var minimumFontScale: Float? = null,
  var textDecorationLine: String? = null,
  var textTransform: String? = null,
  var hyphenation: String? = null,
) {
  fun applyTo(textView: TextView) {
    val needsSpannable = textDecorationLine != null || baselineShift != null || textTransform != null
    if (needsSpannable) {
      if (rawText.isEmpty() && !textView.text.isNullOrEmpty()) {
        rawText = textView.text.toString()
      }
      val transformed = applyTextTransform(rawText)
      val spannable = SpannableString(transformed)

      if (textDecorationLine?.contains("underline") == true) {
        spannable.setSpan(UnderlineSpan(), 0, spannable.length, 0)
      }
      if (textDecorationLine?.contains("line-through") == true) {
        spannable.setSpan(StrikethroughSpan(), 0, spannable.length, 0)
      }
      if (baselineShift != null) {
        spannable.setSpan(BaselineShiftSpan(baselineShift ?: 0f), 0, spannable.length, 0)
      }
      textView.text = spannable
    }

    if (letterSpacing != null) {
      val size = textView.textSize
      val spacing = letterSpacing ?: 0f
      textView.letterSpacing = if (size > 0f) spacing / size else 0f
    }

    val baseLineHeight = textView.paint.fontMetrics.run { bottom - top }
    var extra = 0f
    lineHeight?.let { extra += (it - baseLineHeight) }
    lineSpacing?.let { extra += it }
    if (extra < 0f) extra = 0f
    textView.setLineSpacing(extra, 1f)

    if (minimumFontScale != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val scale = minimumFontScale ?: 1f
      val maxSize = textView.textSize
      val minSize = (maxSize * scale).coerceAtLeast(1f)
      textView.setAutoSizeTextTypeUniformWithConfiguration(
        minSize.toInt(),
        maxSize.toInt(),
        1,
        android.util.TypedValue.COMPLEX_UNIT_PX
      )
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      textView.hyphenationFrequency =
        if (hyphenation == "none") android.text.Layout.HYPHENATION_FREQUENCY_NONE
        else android.text.Layout.HYPHENATION_FREQUENCY_NORMAL
    }
  }

  private fun applyTextTransform(text: String): String {
    return when (textTransform) {
      "uppercase" -> text.uppercase()
      "lowercase" -> text.lowercase()
      "capitalize" -> text.split(Regex("\\s+")).joinToString(" ") {
        if (it.isEmpty()) it else it.replaceFirstChar { c -> c.uppercase() }
      }
      else -> text
    }
  }
}
