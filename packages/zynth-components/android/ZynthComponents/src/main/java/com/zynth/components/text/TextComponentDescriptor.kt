package com.zynth.components.text

import android.graphics.Typeface
import android.util.Log
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.text.PrecomputedTextCompat
import androidx.core.widget.TextViewCompat
import com.zynth.kit.components.ZynthComponentDescriptor
import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.runtime.FontRegistry
import com.zynth.kit.layout.MeasureMode
import com.zynth.kit.layout.Style
import java.util.concurrent.Executors
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

private fun isIconFontFamily(family: String): Boolean {
  return family.contains("Icon")
}

private data class TextMeasureCache(
  val key: Int,
  val width: Float,
  val height: Float,
)

private fun hashMeasureKey(
  text: CharSequence,
  textView: TextView,
  widthSpec: Int,
  heightSpec: Int,
): Int {
  var result = text.hashCode()
  result = 31 * result + textView.textSize.toBits()
  result = 31 * result + (textView.typeface?.hashCode() ?: 0)
  result = 31 * result + textView.letterSpacing.toBits()
  result = 31 * result + textView.maxLines
  result = 31 * result + widthSpec
  result = 31 * result + heightSpec
  return result
}

private object TextRebuildScheduler {
  private data class Queue(
    val pending: LinkedHashSet<Int>,
    var scheduled: Boolean,
    val composer: TextComposer,
  )

  private val mainHandler = Handler(Looper.getMainLooper())
  private val queues = java.util.WeakHashMap<ZynthUIManager, Queue>()
  private val precomputeExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "ZynthTextPrecompute").apply { isDaemon = true }
  }

  fun enqueue(manager: ZynthUIManager, rootId: Int, styleKey: String) {
    val queue = queues.getOrPut(manager) {
      val density = manager.getRootView().resources.displayMetrics.density
      Queue(
        pending = LinkedHashSet(),
        scheduled = false,
        composer = TextComposer(density, styleKey) { id -> manager.getNodeState(id) },
      )
    }
    queue.pending.add(rootId)
    if (queue.scheduled) return
    queue.scheduled = true
    mainHandler.post { drain(manager) }
  }

  private fun drain(manager: ZynthUIManager) {
    val queue = queues[manager] ?: return
    queue.scheduled = false
    if (queue.pending.isEmpty()) return
    val toProcess = queue.pending.toList()
    queue.pending.clear()
    for (rootId in toProcess) {
      val root = manager.getNodeState(rootId) ?: continue
      if (root.type != "text") continue
      val composed = queue.composer.compose(root)
      val textView = root.view as? TextView ?: continue
      if (DEBUG_TEXT) {
        val text = composed.text.toString()
        val sample = text.take(16).map { Integer.toHexString(it.code) }.joinToString(" ")
        val family = composed.effectiveStyle?.fontFamily
        Log.d(
          "ZynthText",
          "rebuild root=${root.id} len=${text.length} sample=[$sample] family=$family",
        )
      }
      applyPrecomputedText(textView, composed.text, precomputeExecutor)
      manager.markNodeDirty(root.id)
    }
  }
}

/**
 * Creates and returns the Text component descriptor.
 */
fun createTextComponentDescriptor(): ZynthComponentDescriptor {
  val textStyleKey = "textStyle"
  val textManagerKey = "textManager"
  val textMeasureCacheKey = "textMeasureCache"
  return ZynthComponentDescriptor(
    type = "text",
    createView = { context, _ -> ZynthTextView(context) },
    onNodeCreated = { manager, node ->
      val textView = node.view as? TextView ?: return@ZynthComponentDescriptor
      
      // Set up measurement handler for text
      val measureTag = "ZynthText/measure"
      manager.getLayoutEngine().setMeasureHandler(node.id) { input ->
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
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        val heightSpec = when (input.heightMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        
        val currentText = textView.text ?: ""
        val cacheKey = hashMeasureKey(currentText, textView, widthSpec, heightSpec)
        val cached = node.attachments[textMeasureCacheKey] as? TextMeasureCache
        if (cached != null && cached.key == cacheKey) {
          return@setMeasureHandler cached.width to cached.height
        }

        if (currentText.isEmpty()) {
          val measuredWidth = 0f
          val measuredHeight = (textView.textSize * 1.2f).coerceAtLeast(1f)
          node.attachments[textMeasureCacheKey] =
            TextMeasureCache(cacheKey, measuredWidth, measuredHeight)
          return@setMeasureHandler measuredWidth to measuredHeight
        }

        textView.measure(widthSpec, heightSpec)
        val measuredWidth = textView.measuredWidth.coerceAtLeast(1).toFloat()
        val measuredHeight = textView.measuredHeight
          .coerceAtLeast((textView.textSize * 1.2f).roundToInt())
          .toFloat()
        node.attachments[textMeasureCacheKey] =
          TextMeasureCache(cacheKey, measuredWidth, measuredHeight)
        val durationMs = (SystemClock.elapsedRealtimeNanos() - measureStart) / 1_000_000.0
        if (durationMs > 8) {
          Log.w(
            measureTag,
            "Slow text measure: node=${node.id} text='${node.cachedText.take(24)}' duration=${"%.2f".format(durationMs)}ms",
          )
        }
        measuredWidth to measuredHeight
      }
      
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
        updateComposedText(node, textStyleKey, textManagerKey)
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
    onChildInserted = { manager, parent, _, _ ->
      updateComposedText(parent, textStyleKey, textManagerKey)
    },
    onChildRemoved = { manager, parent, _ ->
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
  val rootTextView = root.view as? TextView
  if (rootTextView != null) {
    val immediateText = buildRawText(root, manager, textStyleKey)
    if (rootTextView.text.toString() != immediateText) {
      rootTextView.text = immediateText
      manager.markNodeDirty(root.id)
    }
  }
  if (!subtreeNeedsSpans(root, manager, textStyleKey)) {
    return
  }
  TextRebuildScheduler.enqueue(manager, root.id, textStyleKey)
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

private fun subtreeNeedsSpans(
  node: ZynthUIManager.Node,
  manager: ZynthUIManager,
  textStyleKey: String,
): Boolean {
  val style = node.attachments[textStyleKey] as? TextStyleAttributes
  if (style?.requiresSpans() == true) return true
  for (childId in node.textChildren) {
    val child = manager.getNodeState(childId) ?: continue
    if (child.type != "text") continue
    if (subtreeNeedsSpans(child, manager, textStyleKey)) return true
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

private fun applyPrecomputedText(
  textView: TextView,
  text: CharSequence,
  executor: java.util.concurrent.Executor
) {
  if (text.isEmpty()) {
    textView.text = text
    return
  }
  val params = TextViewCompat.getTextMetricsParams(textView)
  executor.execute {
    val precomputed = PrecomputedTextCompat.create(text, params)
    textView.post {
      TextViewCompat.setPrecomputedText(textView, precomputed)
    }
  }
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
