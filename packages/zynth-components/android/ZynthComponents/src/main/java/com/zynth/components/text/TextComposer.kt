package com.zynth.components.text

import android.graphics.Paint
import android.graphics.Typeface
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.TextPaint
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import android.text.style.StrikethroughSpan
import android.text.style.UnderlineSpan
import android.util.Log
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.runtime.FontRegistry

internal data class ComposedText(val text: CharSequence, val effectiveStyle: TextStyleAttributes?)

private const val DEBUG_TEXT = false

internal class TextComposer(
  private val density: Float,
  private val styleKey: String,
  private val nodeForId: (Int) -> ZynthUIManager.Node?
) {
  private val textType = "text"
  private val typefaceCache = HashMap<String, Typeface>()

  private fun isIconFontFamily(family: String): Boolean {
    return family.contains("Icon")
  }

  fun compose(node: ZynthUIManager.Node, inherited: TextStyleAttributes? = null): ComposedText {
    val ownStyle = node.attachments[styleKey] as? TextStyleAttributes
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
      val child = nodeForId(childId) ?: return@forEach
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

    style.fontSize?.let { size ->
      builder.setSpan(AbsoluteSizeSpan(dpToPx(size).toInt()), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
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

    style.letterSpacing?.let { spacing ->
      builder.setSpan(LetterSpacingSpan(dpToPx(spacing)), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    style.lineHeight?.let { height ->
      builder.setSpan(ExactLineHeightSpan(dpToPx(height)), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    style.baselineShift?.let { shift ->
      builder.setSpan(BaselineShiftSpan(dpToPx(shift)), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
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
    val cacheKey = "${family ?: "default"}|$tfStyle"
    val canCache = family == null || FontRegistry.isLoaded(family)
    if (canCache) {
      typefaceCache[cacheKey]?.let { return it }
    }
    return if (family != null) {
      val customTypeface = FontRegistry.getTypeface(family)
      if (customTypeface != null) {
        if (isIconFontFamily(family)) {
          customTypeface.also { if (canCache) typefaceCache[cacheKey] = it }
        } else if (tfStyle != Typeface.NORMAL) {
          Typeface.create(customTypeface, tfStyle).also { if (canCache) typefaceCache[cacheKey] = it }
        } else {
          customTypeface.also { if (canCache) typefaceCache[cacheKey] = it }
        }
      } else {
        Typeface.create(family, tfStyle).also { if (canCache) typefaceCache[cacheKey] = it }
      }
    } else if (tfStyle != Typeface.NORMAL) {
      Typeface.create(Typeface.DEFAULT, tfStyle).also { if (canCache) typefaceCache[cacheKey] = it }
    } else null
  }

  private fun dpToPx(value: Float): Float = if (density == 0f) value else value * density

  private class LetterSpacingSpan(private val spacingPx: Float) : MetricAffectingSpan() {
    override fun updateDrawState(tp: TextPaint) = apply(tp)
    override fun updateMeasureState(tp: TextPaint) = apply(tp)
    private fun apply(tp: TextPaint) {
      // Guard against invalid text size to prevent invisible text (NaN/Infinity)
      val base = if (tp.textSize > 1f) tp.textSize else 16f * tp.density
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
      val targetHeight = heightPx.toInt()
      val originHeight = fm.descent - fm.ascent
      if (originHeight <= 0) {
        fm.ascent = -targetHeight
        fm.descent = 0
        fm.top = fm.ascent
        fm.bottom = fm.descent
        return
      }

      if (fm.descent > targetHeight) {
        fm.descent = targetHeight.coerceAtMost(fm.descent)
        fm.ascent = 0
        fm.top = fm.ascent
        fm.bottom = fm.descent
      } else if (-fm.ascent + fm.descent > targetHeight) {
        fm.bottom = fm.descent
        fm.ascent = -targetHeight + fm.descent
        fm.top = fm.ascent
      } else if (-fm.ascent + fm.bottom > targetHeight) {
        fm.top = fm.ascent
        fm.bottom = fm.ascent + targetHeight
      } else if (-fm.top + fm.bottom > targetHeight) {
        fm.top = fm.bottom - targetHeight
      } else {
        val additionalContent = targetHeight - (-fm.ascent + fm.descent)
        val ascentDiff = (additionalContent / 2.0f).toInt()
        val descentDiff = additionalContent - ascentDiff
        fm.ascent -= ascentDiff
        fm.descent += descentDiff
        fm.top = minOf(fm.top, fm.ascent)
        fm.bottom = maxOf(fm.bottom, fm.descent)
      }
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
