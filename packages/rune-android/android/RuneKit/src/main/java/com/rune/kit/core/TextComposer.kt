package com.rune.kit.core

import android.graphics.Paint
import android.graphics.Typeface
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.TextPaint
import android.text.style.ForegroundColorSpan
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.util.SparseArray
import com.rune.kit.core.RuneUIManager.Node

internal data class ComposedText(val text: CharSequence, val effectiveStyle: TextStyleAttributes?)

internal class TextComposer(
  private val nodes: SparseArray<Node>,
) {
  private val textType = "text"

  fun compose(node: Node, inherited: TextStyleAttributes? = null): ComposedText {
    val ownStyle = node.textStyle
    val merged = when {
      ownStyle != null && inherited != null -> ownStyle.mergeWith(inherited)
      ownStyle != null -> ownStyle
      else -> inherited
    }

    if (node.textChildren.isEmpty()) {
      val textContent = applyTransform(node.cachedText, merged?.textTransform)
      val builder = SpannableStringBuilder(textContent)
      applySpans(builder, merged)
      return ComposedText(builder, merged)
    }

    val builder = SpannableStringBuilder()
    node.textChildren.forEach { childId ->
      val child = nodes.get(childId) ?: return@forEach
      if (child.type != textType) return@forEach
      val childResult = compose(child, merged)
      builder.append(childResult.text)
    }
    return ComposedText(builder, merged)
  }

  private fun applyTransform(text: String, transform: String?): String {
    return when (transform) {
      "uppercase" -> text.uppercase()
      "lowercase" -> text.lowercase()
      "capitalize" -> text.split(" ").joinToString(" ") { part ->
        part.lowercase().replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
      }
      else -> text
    }
  }

  private fun applySpans(builder: SpannableStringBuilder, style: TextStyleAttributes?) {
    if (style == null) return
    val start = 0
    val end = builder.length
    if (end == 0) return

    style.color?.let { builder.setSpan(ForegroundColorSpan(it), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE) }

    val isBold = style.fontWeight?.let { weight ->
      weight.equals("bold", ignoreCase = true) || weight.toIntOrNull()?.let { it >= 600 } == true
    } ?: false
    val isItalic = style.fontStyle?.equals("italic", ignoreCase = true) == true
    when {
      isBold && isItalic -> builder.setSpan(StyleSpan(Typeface.BOLD_ITALIC), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
      isBold -> builder.setSpan(StyleSpan(Typeface.BOLD), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
      isItalic -> builder.setSpan(StyleSpan(Typeface.ITALIC), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    buildTypeface(style)?.let { tf ->
      builder.setSpan(CustomTypefaceSpan(tf), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    style.textDecorationLine?.let { deco ->
      if (deco.contains("underline")) builder.setSpan(UnderlineSpan(), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
      if (deco.contains("line-through") || deco.contains("strikethrough")) {
        builder.setSpan(StrikethroughSpan(), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    }

    style.letterSpacing?.let { spacingPx ->
      builder.setSpan(LetterSpacingSpan(spacingPx), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    style.lineHeight?.let { height ->
      builder.setSpan(ExactLineHeightSpan(height), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    style.baselineShift?.let { shift ->
      builder.setSpan(BaselineShiftSpan(shift), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
  }

  private fun buildTypeface(style: TextStyleAttributes): Typeface? {
    val weight = style.fontWeight
    val isBold = weight?.let { it.equals("bold", ignoreCase = true) || it.toIntOrNull()?.let { w -> w >= 600 } == true } ?: false
    val isItalic = style.fontStyle?.equals("italic", ignoreCase = true) == true
    val tfStyle = when {
      isBold && isItalic -> Typeface.BOLD_ITALIC
      isBold -> Typeface.BOLD
      isItalic -> Typeface.ITALIC
      else -> Typeface.NORMAL
    }
    val family = style.fontFamily
    return if (family != null) {
      Typeface.create(family, tfStyle)
    } else if (tfStyle != Typeface.NORMAL) {
      Typeface.create(Typeface.DEFAULT, tfStyle)
    } else null
  }

  private class LetterSpacingSpan(private val spacingPx: Float) : MetricAffectingSpan() {
    override fun updateDrawState(tp: TextPaint) = apply(tp)
    override fun updateMeasureState(tp: TextPaint) = apply(tp)
    private fun apply(tp: TextPaint) {
      val base = if (tp.textSize != 0f) tp.textSize else 1f
      tp.letterSpacing = spacingPx / base
    }
  }

  private class ExactLineHeightSpan(private val heightPx: Float) : LineHeightSpan {
    override fun chooseHeight(
      text: CharSequence?,
      start: Int,
      end: Int,
      spanstartv: Int,
      lineHeight: Int,
      fm: Paint.FontMetricsInt,
    ) {
      val originHeight = fm.descent - fm.ascent
      if (originHeight <= 0) return
      val ratio = heightPx / originHeight
      fm.ascent = (fm.ascent * ratio).toInt()
      fm.descent = fm.ascent + heightPx.toInt()
      fm.top = fm.ascent
      fm.bottom = fm.descent
    }
  }

  private class BaselineShiftSpan(private val shiftPx: Float) : MetricAffectingSpan() {
    override fun updateDrawState(tp: TextPaint) = apply(tp)
    override fun updateMeasureState(tp: TextPaint) = apply(tp)
    private fun apply(tp: TextPaint) {
      tp.baselineShift += shiftPx.toInt()
    }
  }

  private class CustomTypefaceSpan(private val typeface: Typeface) : MetricAffectingSpan() {
    override fun updateDrawState(tp: TextPaint) = apply(tp)
    override fun updateMeasureState(tp: TextPaint) = apply(tp)
    private fun apply(tp: TextPaint) {
      tp.typeface = typeface
    }
  }
}
