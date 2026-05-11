package com.zynth.components.text

import android.content.Context
import android.graphics.Typeface
import android.util.Log
import android.os.SystemClock
import android.util.TypedValue
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.runtime.FontRegistry
import com.zynth.kit.layout.MeasureMode
import com.zynth.kit.layout.Style
import kotlin.math.roundToInt

/**
 * Helper function to parse JSON string values
 */
private fun parseString(json: String?): String? {
  if (json == null || json == "null") return null
  if (json.length >= 2 && json.startsWith("\"") && json.endsWith("\"")) {
    return json.substring(1, json.length - 1)
  }
  return json
}

private const val DEBUG_TEXT = false
private const val TEXT_MEASURE_CACHE_KEY = "textMeasureCache"

private fun isIconFontFamily(family: String): Boolean {
  return family.contains("Icon")
}

private data class TextMeasureCache(
  val key: Int,
  val width: Float,
  val height: Float,
)

private data class ResolvedMeasureText(
  val text: CharSequence,
  val plainText: String,
  val usesSpans: Boolean,
)

private fun hashMeasureKey(
  text: String,
  usesSpans: Boolean,
  textView: TextView,
  widthSpec: Int,
  heightSpec: Int,
): Int {
  var result = text.hashCode()
  result = 31 * result + usesSpans.hashCode()
  result = 31 * result + textView.textSize.toBits()
  result = 31 * result + (textView.typeface?.hashCode() ?: 0)
  result = 31 * result + textView.letterSpacing.toBits()
  result = 31 * result + textView.maxLines
  result = 31 * result + widthSpec
  result = 31 * result + heightSpec
  return result
}

private fun rebuildComposedText(manager: ZynthUIManager, rootId: Int, styleKey: String) {
  val root = manager.getNodeState(rootId) ?: return
  if (root.type != "text") return
  val textView = root.view as? TextView ?: return
  val density = manager.getRootView().resources.displayMetrics.density
  val composer = TextComposer(density, styleKey) { id -> manager.getNodeState(id) }
  val composed = composer.compose(root)
  val previous = textView.text?.toString() ?: ""
  val next = composed.text.toString()
  // Always apply composed text so span-only style changes (color/weight/lineHeight/etc.)
  // are reflected even when the raw string is unchanged.
  applyTextSynchronously(textView, composed.text)
  if (previous != next) {
    manager.markNodeDirty(root.id)
  }
}

private fun rebuildRawText(manager: ZynthUIManager, rootId: Int, styleKey: String) {
  val root = manager.getNodeState(rootId) ?: return
  if (root.type != "text") return
  val rootTextView = root.view as? TextView ?: return
  val immediateText = buildRawText(root, manager, styleKey)
  if (immediateText.isEmpty() && root.cachedText.isNotEmpty()) {
    android.util.Log.w("ZynthLayout", "rebuildRawText: resulting text is empty for node $rootId despite cachedText='${root.cachedText}'")
  }
  if (rootTextView.text.toString() != immediateText) {
    rootTextView.text = immediateText
    manager.markNodeDirty(root.id)
  }
}

private fun resolveTextTypeface(
  textView: TextView,
  style: TextStyleAttributes?,
): Typeface {
  val weight = style?.fontWeight
  val isBold = weight?.let {
    it.equals("bold", ignoreCase = true) || it.toIntOrNull()?.let { w -> w >= 600 } == true
  } ?: false
  val isItalic = style?.fontStyle?.equals("italic", ignoreCase = true) == true
  val styleInt = when {
    isBold && isItalic -> Typeface.BOLD_ITALIC
    isBold -> Typeface.BOLD
    isItalic -> Typeface.ITALIC
    else -> Typeface.NORMAL
  }

  val family = style?.fontFamily
  val cachedTypeface = family?.let { FontRegistry.getTypeface(it) }
  val baseTypeface = when {
    family == null -> textView.typeface ?: Typeface.DEFAULT
    cachedTypeface != null -> cachedTypeface
    else -> Typeface.create(family, styleInt)
  }

  return when {
    family != null && cachedTypeface != null && isIconFontFamily(family) -> baseTypeface
    else -> Typeface.create(baseTypeface ?: Typeface.DEFAULT, styleInt)
  }
}

private fun resolveMeasureText(
  node: ZynthUIManager.Node,
  manager: ZynthUIManager,
  textStyleKey: String,
): ResolvedMeasureText {
  val root = findTextRoot(node, manager)
  val hasInlineSpans = subtreeNeedsInlineSpans(root, manager, textStyleKey, isRoot = true)
  val rootStyle = root.attachments[textStyleKey] as? TextStyleAttributes
  val rootNeedsSpans = rootStyle?.let { needsRootSpanStyles(it) } ?: false
  if (!hasInlineSpans && !rootNeedsSpans) {
    val rawText = buildRawText(root, manager, textStyleKey)
    return ResolvedMeasureText(
      text = rawText,
      plainText = rawText,
      usesSpans = false,
    )
  }

  val density = manager.getRootView().resources.displayMetrics.density
  val composer = TextComposer(density, textStyleKey) { id -> manager.getNodeState(id) }
  val composed = composer.compose(root)
  return ResolvedMeasureText(
    text = composed.text,
    plainText = composed.text.toString(),
    usesSpans = true,
  )
}


private val measureViews = java.util.WeakHashMap<ZynthUIManager, TextView>()

private fun getMeasureView(manager: ZynthUIManager, context: Context): TextView {
  synchronized(measureViews) {
    return measureViews.getOrPut(manager) {
      ZynthTextView(context).apply {
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        // Ensure measurement view never has padding
        setPadding(0, 0, 0, 0)
      }
    }
  }
}

/**
 * Creates and returns the Text component descriptor.
 */
fun createTextComponentDescriptor(): ZynthComponentDescriptor {
  val textStyleKey = "textStyle"
  val textManagerKey = "textManager"
  return ZynthComponentDescriptor(
    type = "text",
    createView = { context, _ -> ZynthTextView(context) },
    onNodeCreated = { manager, node ->
      val textView = node.view as? TextView ?: return@ZynthComponentDescriptor
      
      // Set up measurement handler for text
      val measureTag = "ZynthText/measure"
      val handler: com.zynth.kit.layout.MeasureHandler = handler@{ input ->
        if (input.height <= 0f && input.heightMode != MeasureMode.UNDEFINED) {
          android.util.Log.v("ZynthLayout", "Text measure constraints: node=${node.id} w=${input.width}(${input.widthMode}) h=${input.height}(${input.heightMode})")
        }
        val measureStart = SystemClock.elapsedRealtimeNanos()
        val widthValue = when {
          input.width.isNaN() -> 0
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        }
        val heightValue = when {
          input.height.isNaN() -> 0
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        }
        
        val widthSpec = when (input.widthMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(widthValue.coerceAtLeast(0), MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(widthValue.coerceAtLeast(0), MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        val heightSpec = when (input.heightMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(heightValue.coerceAtLeast(0), MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(heightValue.coerceAtLeast(0), MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        
        val resolvedMeasureText = resolveMeasureText(node, manager, textStyleKey)
        val currentText = resolvedMeasureText.plainText
        val root = findTextRoot(node, manager)
        val style = root.attachments[textStyleKey] as? TextStyleAttributes
        val hasVolatileZeroHeightConstraint =
          currentText.isNotEmpty() &&
            input.height <= 0f &&
            input.heightMode != MeasureMode.UNDEFINED
        val effectiveHeightSpec = if (hasVolatileZeroHeightConstraint) {
          // A transient zero-height constraint can appear while ancestor padding/margin
          // animations cross through a collapsed content box. Measuring intrinsic text
          // height with that exact spec makes TextView return 0 and can poison Yoga's
          // cached measurement for the pulse.
          MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        } else {
          heightSpec
        }
        val cacheKey = hashMeasureKey(
          currentText,
          resolvedMeasureText.usesSpans,
          textView,
          widthSpec,
          effectiveHeightSpec,
        )
        val cached = node.attachments[TEXT_MEASURE_CACHE_KEY] as? TextMeasureCache
        if (cached != null && cached.key == cacheKey) {
          return@handler cached.width to cached.height
        }

        if (currentText.isEmpty()) {
          val measuredWidth = 0f
          val measuredHeight = (textView.textSize * 1.2f).coerceAtLeast(1f)
          node.attachments[TEXT_MEASURE_CACHE_KEY] =
            TextMeasureCache(cacheKey, measuredWidth, measuredHeight)
          return@handler measuredWidth to measuredHeight
        }

        // Use a dedicated measurement view to avoid race conditions with the UI thread.
        // The UI thread may be measuring the live textView instance during transitions,
        // which causes IllegalStateException if measured concurrently on the JS/Layout thread.
        val measureView = getMeasureView(manager, textView.context)
        var measuredWidth: Float
        var measuredHeight: Float

        try {
          synchronized(measureView) {
            val resolvedTextSizePx = style?.fontSize?.let { fontSize ->
              val density = textView.resources.displayMetrics.density
              if (density == 0f) fontSize else fontSize * density
            } ?: textView.textSize

            measureView.setTextSize(TypedValue.COMPLEX_UNIT_PX, resolvedTextSizePx)
            measureView.typeface = resolveTextTypeface(textView, style)
            if (resolvedMeasureText.usesSpans) {
              measureView.setLineSpacing(0f, 1f)
              measureView.letterSpacing = 0f
            } else {
              measureView.letterSpacing = textView.letterSpacing
            }
            if (measureView.text != resolvedMeasureText.text) {
              measureView.text = resolvedMeasureText.text
            }
            measureView.maxLines = textView.maxLines
            measureView.ellipsize = textView.ellipsize
            measureView.includeFontPadding =
              style?.fontFamily?.let { !isIconFontFamily(it) } ?: textView.includeFontPadding

            measureView.measure(widthSpec, effectiveHeightSpec)
            val mwResult = measureView.measuredWidth.toFloat()
            val mhResult = measureView.measuredHeight.toFloat()
            
            if (mhResult <= 0f && input.heightMode != MeasureMode.UNDEFINED && currentText.isNotEmpty()) {
                android.util.Log.w("ZynthLayout", "Text measurement returned zero height! node=${node.id} text='$currentText' width=$mwResult (inputW=${input.width}, mode=${input.widthMode}) height=$mhResult (inputH=${input.height}, mode=${input.heightMode})")
            }

            val fallbackHeight = (measureView.textSize * 1.2f).coerceAtLeast(1f)
            measuredWidth = if (mwResult <= 0f && currentText.isNotEmpty()) {
                measureView.paint.measureText(currentText).coerceAtLeast(1f)
            } else {
                mwResult.coerceAtLeast(0f)
            }
            measuredHeight = if (mhResult <= 0f && currentText.isNotEmpty()) {
                fallbackHeight
            } else {
                mhResult.coerceAtLeast(0f)
            }
          }
        } catch (error: Throwable) {
          android.util.Log.e("ZynthLayout", "Error measuring text node ${node.id}: ${error.message}", error)
          measuredWidth = when (input.widthMode) {
            MeasureMode.EXACTLY -> widthValue.coerceAtLeast(0).toFloat()
            MeasureMode.AT_MOST -> textView.paint.measureText(currentText)
              .coerceIn(0f, widthValue.coerceAtLeast(0).toFloat())
            MeasureMode.UNDEFINED -> textView.paint.measureText(currentText).coerceAtLeast(0f)
          }
          measuredHeight = (textView.textSize * 1.2f).coerceAtLeast(1f)
        }
        if (!hasVolatileZeroHeightConstraint) {
          node.attachments[TEXT_MEASURE_CACHE_KEY] =
            TextMeasureCache(cacheKey, measuredWidth, measuredHeight)
        }
        val durationMs = (SystemClock.elapsedRealtimeNanos() - measureStart) / 1_000_000.0
        if (durationMs > 8) {
          Log.w(
            measureTag,
            "Slow text measure: node=${node.id} text='${node.cachedText.take(24)}' duration=${"%.2f".format(durationMs)}ms",
          )
        }
        measuredWidth to measuredHeight
      }
      
      node.measureHandler = handler
      manager.getLayoutEngine().setMeasureHandler(node.id, handler)
      
      // Set appropriate layout params
      node.view.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
      node.attachments[textManagerKey] = manager
    },
    applyProperty = { node, name, jsonValue ->
      val textView = node.view as? TextView
      if (textView == null) {
        false
      } else {
        when (name) {
          "text" -> {
            val startNs = SystemClock.elapsedRealtimeNanos()
            val text = parseString(jsonValue) ?: ""
            if (text == node.cachedText) {
              return@ZynthComponentDescriptor true
            }
            node.cachedText = text
            updateComposedText(node, textStyleKey, textManagerKey)
            val durationMs = (SystemClock.elapsedRealtimeNanos() - startNs) / 1_000_000.0
            if (durationMs > 4) {
              Log.w(
                "ZynthText/setProp",
                "Slow text prop: node=${node.id} duration=${"%.2f".format(durationMs)}ms",
              )
            }
            true
          }
          "numberOfLines" -> {
            val lines = jsonValue?.toIntOrNull() ?: 0
            textView.maxLines = if (lines > 0) lines else Int.MAX_VALUE
            val manager = node.attachments[textManagerKey] as? ZynthUIManager
            val root = manager?.let { findTextRoot(node, it) }
            if (manager != null && root != null) {
              manager.markNodeDirty(root.id)
            }
            true
          }
          else -> false
        }
      }
    },
    onStyleApplied = { node, style ->
      val styleStart = SystemClock.elapsedRealtimeNanos()

      // Always capture text style attributes for composition (even for virtual text nodes).
      // Merge with existing to preserve previously-set props because style is applied per-key.
      val nextAttrs = TextStyleAttributes.fromStyle(style)
      val existing = node.attachments[textStyleKey] as? TextStyleAttributes
      if (nextAttrs.isEmpty()) {
        return@ZynthComponentDescriptor
      }
      val merged = if (existing != null) {
        nextAttrs.mergeWith(existing)
      } else {
        nextAttrs
      }
      val didChange = existing == null || merged != existing
      if (didChange) {
        node.attachments[textStyleKey] = merged
      }

      // Apply text-specific styling to TextView (only for non-virtual text nodes)
      val textView = node.view as? TextView
      if (textView != null && didChange) {
        if (existing?.fontSize != merged.fontSize) {
          merged.fontSize?.let { fontSize ->
            val density = textView.resources.displayMetrics.density
            val scaled = if (density == 0f) fontSize else fontSize * density
            textView.setTextSize(TypedValue.COMPLEX_UNIT_PX, scaled)
          }
        }

        if (existing?.color != merged.color) {
          merged.color?.let { color ->
            textView.setTextColor(color)
          }
        }

        val weight = merged.fontWeight
        val isBold = weight?.let {
          it.equals("bold", ignoreCase = true) || it.toIntOrNull()?.let { w -> w >= 600 } == true
        } ?: false
        val isItalic = merged.fontStyle?.equals("italic", ignoreCase = true) == true
        val styleInt = when {
          isBold && isItalic -> Typeface.BOLD_ITALIC
          isBold -> Typeface.BOLD
          isItalic -> Typeface.ITALIC
          else -> Typeface.NORMAL
        }

        val typefaceChanged = existing == null ||
          existing.fontFamily != merged.fontFamily ||
          existing.fontWeight != merged.fontWeight ||
          existing.fontStyle != merged.fontStyle
        if (typefaceChanged) {
          val family = merged.fontFamily
          val cachedTypeface = family?.let { FontRegistry.getTypeface(it) }
          val baseTypeface = when {
            family == null -> Typeface.DEFAULT
            cachedTypeface != null -> cachedTypeface
            else -> {
              Typeface.create(family, styleInt)
            }
          }

          if (baseTypeface != null) {
            if (family != null && cachedTypeface != null && isIconFontFamily(family)) {
              textView.typeface = baseTypeface
            } else {
              textView.setTypeface(Typeface.create(baseTypeface, styleInt))
            }
          } else {
            textView.setTypeface(Typeface.DEFAULT, styleInt)
          }
        }
      }

      if (didChange) {
        val manager = node.attachments[textManagerKey] as? ZynthUIManager
        val root = manager?.let { findTextRoot(node, it) }
        val hasInlineSpans =
          if (manager != null && root != null) {
            subtreeNeedsInlineSpans(root, manager, textStyleKey, isRoot = true)
          } else {
            false
          }
        val usesSpanDrivenRendering =
          hasInlineSpans || merged.let { needsRootSpanStyles(it) }
        if (usesSpanDrivenRendering && textView != null) {
          textView.setLineSpacing(0f, 1f)
          textView.letterSpacing = 0f
        }
        val shouldRecompose = shouldRecomposeText(existing, merged, hasInlineSpans)
        if (shouldRecompose) {
          updateComposedText(node, textStyleKey, textManagerKey)
        }
        if (didTextMetricsChange(existing, merged) && manager != null && root != null) {
          manager.markNodeDirty(root.id)
        }
      }
      val durationMs = (SystemClock.elapsedRealtimeNanos() - styleStart) / 1_000_000.0
      if (durationMs > 4) {
        Log.w(
          "ZynthText/style",
          "Slow text style: node=${node.id} duration=${"%.2f".format(durationMs)}ms",
        )
      }
    },
    onSetHandler = { _, _ ->
      // Text doesn't handle any specific events
      false
    },
    onReset = { node ->
      val textView = node.view as? TextView ?: return@ZynthComponentDescriptor
      textView.text = ""
      node.cachedText = ""
      node.textChildren.clear()
      node.attachments.remove(textStyleKey)
      node.attachments.remove(textManagerKey)
    },
    onChildInserted = { _, parent, _, _ ->
      updateComposedText(parent, textStyleKey, textManagerKey)
    },
    onChildRemoved = { _, parent, _ ->
      updateComposedText(parent, textStyleKey, textManagerKey)
    }
  )
}

private fun updateComposedText(
  node: ZynthUIManager.Node,
  textStyleKey: String,
  textManagerKey: String,
) {
  val manager = node.attachments[textManagerKey] as? ZynthUIManager ?: return
  val root = findTextRoot(node, manager)
  root.attachments.remove(TEXT_MEASURE_CACHE_KEY)
  val hasInlineSpans = subtreeNeedsInlineSpans(root, manager, textStyleKey, isRoot = true)
  val rootStyle = root.attachments[textStyleKey] as? TextStyleAttributes
  val rootNeedsSpans = rootStyle?.let { needsRootSpanStyles(it) } ?: false
  if (!hasInlineSpans && !rootNeedsSpans) {
    rebuildRawText(manager, root.id, textStyleKey)
    return
  }
  rebuildComposedText(manager, root.id, textStyleKey)
}

private fun shouldRecomposeText(
  previous: TextStyleAttributes?,
  next: TextStyleAttributes,
  hasInlineSpans: Boolean,
): Boolean {
  val nextNeedsRootSpans = needsRootSpanStyles(next)
  if (previous == null) {
    return hasInlineSpans || next.textTransform != null || nextNeedsRootSpans
  }
  if (previous.textTransform != next.textTransform) {
    return true
  }
  if (nextNeedsRootSpans || needsRootSpanStyles(previous)) {
    // Root-level spans are already active (or becoming active), so changes in any
    // text-affecting style must trigger recomposition. Otherwise stale spans
    // (e.g. ForegroundColorSpan from a previous scheme) can keep overriding
    // TextView-level properties like setTextColor.
    return previous.color != next.color ||
      previous.fontSize != next.fontSize ||
      previous.fontWeight != next.fontWeight ||
      previous.fontFamily != next.fontFamily ||
      previous.fontStyle != next.fontStyle ||
      previous.textDecorationLine != next.textDecorationLine ||
      previous.lineHeight != next.lineHeight ||
      previous.lineSpacing != next.lineSpacing ||
      previous.paragraphSpacing != next.paragraphSpacing ||
      previous.letterSpacing != next.letterSpacing ||
      previous.baselineShift != next.baselineShift
  }
  if (!hasInlineSpans) {
    return false
  }
  return previous.color != next.color ||
    previous.fontSize != next.fontSize ||
    previous.fontWeight != next.fontWeight ||
    previous.fontFamily != next.fontFamily ||
    previous.fontStyle != next.fontStyle ||
    previous.lineHeight != next.lineHeight ||
    previous.lineSpacing != next.lineSpacing ||
    previous.paragraphSpacing != next.paragraphSpacing ||
    previous.letterSpacing != next.letterSpacing ||
    previous.textDecorationLine != next.textDecorationLine ||
    previous.baselineShift != next.baselineShift
}

private fun needsRootSpanStyles(style: TextStyleAttributes): Boolean {
  return style.textDecorationLine != null ||
    style.lineHeight != null ||
    style.lineSpacing != null ||
    style.paragraphSpacing != null ||
    style.letterSpacing != null ||
    style.baselineShift != null
}

private fun didTextMetricsChange(
  previous: TextStyleAttributes?,
  next: TextStyleAttributes,
): Boolean {
  if (previous == null) return true
  return previous.fontSize != next.fontSize ||
    previous.fontWeight != next.fontWeight ||
    previous.fontFamily != next.fontFamily ||
    previous.fontStyle != next.fontStyle ||
    previous.lineHeight != next.lineHeight ||
    previous.lineSpacing != next.lineSpacing ||
    previous.paragraphSpacing != next.paragraphSpacing ||
    previous.letterSpacing != next.letterSpacing ||
    previous.minimumFontScale != next.minimumFontScale ||
    previous.baselineShift != next.baselineShift ||
    previous.hyphenation != next.hyphenation ||
    previous.textTransform != next.textTransform
}

private fun findTextRoot(node: ZynthUIManager.Node, manager: ZynthUIManager): ZynthUIManager.Node {
  var current = node
  while (true) {
    val parentId = manager.getParentId(current.id) ?: break
    val parent = manager.getNodeState(parentId) ?: break
    if (parent.type != "text") break
    current = parent
  }
  return current
}

private fun subtreeNeedsInlineSpans(
  node: ZynthUIManager.Node,
  manager: ZynthUIManager,
  textStyleKey: String,
  isRoot: Boolean = false,
): Boolean {
  // Root style is applied directly to TextView; spans are only needed for inline styled descendants.
  if (!isRoot) {
    val style = node.attachments[textStyleKey] as? TextStyleAttributes
    if (style != null && !style.isEmpty()) return true
  }
  if (node.textChildren.isEmpty()) return false
  for (childId in node.textChildren) {
    val child = manager.getNodeState(childId) ?: continue
    if (child.type != "text") continue
    if (subtreeNeedsInlineSpans(child, manager, textStyleKey, isRoot = false)) return true
  }
  return false
}

private fun buildRawText(
  node: ZynthUIManager.Node,
  manager: ZynthUIManager,
  textStyleKey: String,
  inherited: TextStyleAttributes? = null,
  builder: StringBuilder = StringBuilder(),
): String {
  val ownStyle = node.attachments[textStyleKey] as? TextStyleAttributes
  val merged = when {
    ownStyle != null && inherited != null -> ownStyle.mergeWith(inherited)
    ownStyle != null -> ownStyle
    else -> inherited
  }

  if (node.textChildren.isEmpty()) {
    val text = applyTransform(node.cachedText, merged?.textTransform)
    builder.append(text)
    return builder.toString()
  }

  for (childId in node.textChildren) {
    val child = manager.getNodeState(childId) ?: continue
    if (child.type != "text") continue
    buildRawText(child, manager, textStyleKey, merged, builder)
  }
  return builder.toString()
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

private fun applyTextSynchronously(
  textView: TextView,
  text: CharSequence
) {
  textView.text = text
}

/**
 * Registrar that registers the Text component with the ZynthComponentRegistry.
 * Automatically discovered via ServiceLoader.
 */
class TextComponentRegistrar : ZynthComponentRegistrar {
  override fun register(registry: com.zynth.kit.components.ZynthComponentRegistry) {
    val descriptor = createTextComponentDescriptor()
    registry.register(descriptor)
    Log.d("ZynthComponents", "Registered Text component")
  }
}
