package com.zynth.components.text

import android.graphics.Typeface
import android.util.Log
import android.os.SystemClock
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.runtime.FontRegistry
import com.zynth.kit.layout.Style

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

private fun isIconFontFamily(family: String): Boolean {
  return family.contains("Icon")
}

private fun rebuildComposedText(manager: ZynthUIManager, rootId: Int, styleKey: String) {
  val root = manager.getNodeState(rootId) ?: return
  if (root.type != "text") return
  val textView = root.view as? TextView ?: return
  val density = manager.getRootView().resources.displayMetrics.density
  val composer = TextComposer(density, styleKey) { id -> manager.getNodeState(id) }
  val composed = composer.compose(root)
  if (DEBUG_TEXT) {
    val text = composed.text.toString()
    val sample = text.take(16).map { Integer.toHexString(it.code) }.joinToString(" ")
    val family = composed.effectiveStyle?.fontFamily
    Log.d(
      "ZynthText",
      "rebuild root=${root.id} len=${text.length} sample=[$sample] family=$family",
    )
  }
  val previous = textView.text?.toString() ?: ""
  val next = composed.text.toString()
  // Always apply composed text so span-only style changes (color/weight/lineHeight/etc.)
  // are reflected even when the raw string is unchanged.
  applyTextSynchronously(textView, composed.text)
  manager.syncTextNodeMeasurement(root.id)
  if (previous != next) {
    manager.markNodeDirty(root.id)
  }
}

private fun rebuildRawText(manager: ZynthUIManager, rootId: Int, styleKey: String) {
  val root = manager.getNodeState(rootId) ?: return
  if (root.type != "text") return
  val rootTextView = root.view as? TextView ?: return
  val immediateText = buildRawText(root, manager, styleKey)
  if (rootTextView.text.toString() != immediateText) {
    rootTextView.text = immediateText
    manager.syncTextNodeMeasurement(root.id)
    manager.markNodeDirty(root.id)
  } else {
    manager.syncTextNodeMeasurement(root.id)
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
            if (DEBUG_TEXT) {
              val sample = text.take(16).map { Integer.toHexString(it.code) }.joinToString(" ")
              Log.d("ZynthText", "setProp text node=${node.id} len=${text.length} sample=[$sample]")
            }
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
            cachedTypeface != null -> {
              if (DEBUG_TEXT) {
                Log.d("ZynthText", "Using cached typeface for family: $family")
              }
              cachedTypeface
            }
            else -> {
              if (DEBUG_TEXT) {
                Log.w("ZynthText", "FontRegistry miss for family: $family, falling back to system")
              }
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
