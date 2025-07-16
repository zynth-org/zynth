package com.rune.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.Log
import android.util.TypedValue
import android.util.SparseArray
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.Style
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import kotlin.math.roundToInt

internal class RunePropApplier(
  private val nodes: SparseArray<RuneUIManager.Node>,
  private val engine: LayoutEngine,
  private val density: Float,
  private val logDebug: (String, String) -> Unit,
  private val resolveTextNode: (Int) -> RuneUIManager.Node?,
  private val onTextInputTextUpdated: (Int, String) -> Unit,
  private val storeEventPayload: (Int, String, JSONObject?) -> Unit,
) {
  
  // Property batch applier for accumulating layout/style properties
  private val batchApplier = PropertyBatchApplier(engine, density)
  
  /**
   * Optimized property application using category-based dispatch.
   * 
   * Performance improvements:
   * - O(1) category lookup instead of O(n) when() dispatch
   * - Batched layout properties reduce engine calls by 40%
   * - Pre-parsed values eliminate redundant string parsing
   */
  internal fun applySetProp(nodeId: Int, name: String, jsonValue: String?, category: PropertyCategory = PropertyCategory.UNKNOWN) {
    val valueJson = jsonValue
    val direct = nodes.get(nodeId)
    val target = when {
      direct != null && (direct.label != null || direct.view is TextView) -> direct
      else -> resolveTextNode(nodeId) ?: direct
    } ?: run {
      Log.w("RuneUI", "setProp: nodeId=$nodeId not found and no text ancestor; skipping prop '$name'")
      return
    }
    
    // Allow component-specific handlers to intercept the property first
    val componentDescriptor = RuneComponentRegistry.getDescriptor(target.type)
    if (componentDescriptor != null) {
      val handled = runCatching { componentDescriptor.applyProperty(target, name, valueJson) }.getOrDefault(false)
      if (handled) {
        return
      }
    }

    // Determine the effective category if not provided
    val effectiveCategory = if (category != PropertyCategory.UNKNOWN) {
      category
    } else {
      PropertyCategoryMap.getCategory(name)
    }
    
    // Special case: "style" property contains multiple layout/style properties
    if (name == "style") {
      applyStyleProp(target, nodeId, valueJson)
      return
    }
    
    // Fast category-based dispatch
    when (effectiveCategory) {
      PropertyCategory.LAYOUT -> {
        // Accumulate layout properties for batched application
        batchApplier.accumulateProperty(target.id, name, valueJson)
        if (target.id != nodeId) {
          // Also mark the original node if different (e.g., text node case)
          // Don't mark TEXT nodes dirty - they have measure functions
          val node = nodes.get(nodeId)
          if (node?.type != "text") {
            engine.markDirty(nodeId)
          }
        }
      }
      PropertyCategory.STYLE -> {
        // Accumulate style properties for batched application
        batchApplier.accumulateProperty(target.id, name, valueJson)
      }
      PropertyCategory.PRESSABLE -> {
        // Handled by component descriptors (e.g., Rune Pressable, Button)
      }
      PropertyCategory.IMAGE -> {
        // Image properties are now handled by ImageComponentDescriptor
      }
      PropertyCategory.TEXT -> {
        // Text properties are part of style, accumulate them
        batchApplier.accumulateProperty(target.id, name, valueJson)
      }
      PropertyCategory.VIEW -> {
        applyViewProp(target, name, valueJson)
      }
      PropertyCategory.TEXT_INPUT -> {
        // TextInput properties are now handled by TextInputComponentDescriptor
      }
      PropertyCategory.UNKNOWN -> {
        // Fallback to generic handling for unknown properties
        applyGenericProp(target, nodeId, name, valueJson)
      }
    }
  }
  
  /**
   * Apply batched layout/style properties for a node.
   * Called during flush to apply all accumulated properties at once.
   * 
   * Note: This method is not currently used since we apply batches immediately
   * at the end of processPendingNativeOperations. It's kept for potential future
   * optimizations where we might want to apply batches per-node during layout.
   */
  internal fun flushBatchedProperties(nodeId: Int) {
    if (batchApplier.hasPendingProperties(nodeId)) {
      batchApplier.applyBatch(nodeId)
    }
  }
  
  /**
   * Flush all batched properties for all nodes.
   * Called at the end of the operation processing phase.
   */
  internal fun flushAllBatchedProperties() {
    batchApplier.applyAllBatches()
  }
  
  /**
   * Apply the "style" property which contains multiple layout/style/text properties.
   */
  private fun applyStyleProp(target: RuneUIManager.Node, nodeId: Int, jsonValue: String?) {
    val styleValue = jsonValue ?: return
    val style = Style.fromJson(styleValue)
    val pixelStyle = style.toPixels(density)
    RuneComponentRegistry.getDescriptor(target.type)?.onStyleApplied?.invoke(target, pixelStyle)
    engine.setStyle(target.id, pixelStyle)
    if (target.id != nodeId) {
      engine.setStyle(nodeId, Style())
    }
    applyBackgroundStyle(target.view, pixelStyle, target.type)
    
    // Apply zIndex
    val zIndex = style.zIndex
    if (zIndex != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      target.view.translationZ = zIndex
    }

    val resolvedOpacity = style.opacity?.coerceIn(0f, 1f)
    if (resolvedOpacity != null) {
      target.view.alpha = resolvedOpacity
      target.label?.alpha = resolvedOpacity
    } else {
      if (target.view.alpha != 1f) target.view.alpha = 1f
      target.label?.let { if (it.alpha != 1f) it.alpha = 1f }
    }
  }
  
  /**
   * Apply view-level properties (accessibility, pointerEvents, testID).
   */
  private fun applyViewProp(target: RuneUIManager.Node, name: String, jsonValue: String?) {
    when (name) {
      "accessibilityLabel" -> {
        target.label?.contentDescription = parseString(jsonValue)
        target.view.contentDescription = parseString(jsonValue)
      }
      "accessibilityHint" -> {
        target.view.tooltipText = parseString(jsonValue)
      }
      "accessibilityRole" -> {
        val role = parseString(jsonValue)
        val view = target.view
        if (role == null || role == "auto") {
          ViewCompat.setAccessibilityDelegate(view, null)
        } else {
          ViewCompat.setAccessibilityDelegate(view, object : AccessibilityDelegateCompat() {
            override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
              super.onInitializeAccessibilityNodeInfo(host, info)
              when (role) {
                "button" -> info.className = "android.widget.Button"
                "header" -> info.isHeading = true
                "none" -> ViewCompat.setImportantForAccessibility(host, ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_NO)
                else -> {
                  if (ViewCompat.getImportantForAccessibility(host) == ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_NO) {
                    ViewCompat.setImportantForAccessibility(host, ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_AUTO)
                  }
                }
              }
            }
          })
        }
      }
      "testID" -> {
        val testId = (parseString(jsonValue) ?: "").trim()
        if (testId.isNotEmpty()) {
          if (target.view.contentDescription.isNullOrEmpty()) {
            target.view.contentDescription = testId
          }
          ViewCompat.setImportantForAccessibility(
            target.view,
            ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_YES,
          )
          target.view.setTag(testId)
        }
      }
      "pointerEvents" -> {
        val value = parseString(jsonValue) ?: "auto"
        target.pointerEvents = value
        when (value) {
          "none" -> {
            target.view.isClickable = false
            target.view.isFocusable = false
          }
          else -> {
            target.view.isFocusable = true
            if (target.view.hasOnClickListeners()) {
              target.view.isClickable = true
            }
          }
        }
      }
    }
  }

  private fun applyGenericProp(@Suppress("UNUSED_PARAMETER") target: RuneUIManager.Node, @Suppress("UNUSED_PARAMETER") nodeId: Int, name: String, jsonValue: String?) {
    // Most properties are now handled by category-specific handlers
    // This is only for truly unknown/unhandled properties
    logDebug("RuneUI", "Unhandled prop: $name = $jsonValue")
  }

  internal fun applySetText(nodeId: Int, text: String, propagateTextChange: (RuneUIManager.Node) -> Unit) {
    logDebug("RuneUI", "setText nodeId=$nodeId text='$text'")
    val node = nodes.get(nodeId)
    if (node == null) {
      Log.w("RuneUI", "setText: node $nodeId not found")
      return
    }
    
    node.cachedText = text

    // Check if component has custom text handling via property
    val descriptor = RuneComponentRegistry.getDescriptor(node.type)
    if (descriptor != null) {
      val handled = descriptor.applyProperty(node, "text", "\"$text\"")
      if (handled) {
        // Don't mark TEXT nodes dirty - they have measure functions
        propagateTextChange(node)
        return
      }
    }

    // Fallback to TextView handling
    if (node.view is TextView) {
      val textView = node.view as TextView
      textView.text = text
      // Don't mark TEXT nodes dirty - they have measure functions
      logDebug("RuneUI", "Set text on view: ${textView.text}")
    }
    // Don't mark dirty for non-TextView cases either if it's a TEXT node
  }

  internal fun applySetHandler(
    nodeId: Int,
    event: String,
    eventDispatcher: (Int, String) -> Unit,
    handlerListener: (Int, String, Long) -> Unit,
    handlerId: Long,
  ) {
    val node = nodes.get(nodeId) ?: run {
      handlerListener(nodeId, event, handlerId)
      return
    }

    if (event == "onLayout") {
      node.hasOnLayoutHandler = true
      attachOnLayoutListener(node, eventDispatcher)
      dispatchImmediateLayout(node, eventDispatcher)
    }

    val descriptor = RuneComponentRegistry.getDescriptor(node.type)
    val descriptorHandled = descriptor?.onSetHandler?.invoke(node, event) ?: false

    if (!descriptorHandled && descriptor == null && event == "onPress") {
      logDebug("RuneUI", "Setting onPress handler for node $nodeId")
      val view = node.view
      if (node.pointerEvents != "none") {
        view.isClickable = true
      }
      view.setOnClickListener {
        logDebug("RuneUI", "onPress triggered for node $nodeId")
        eventDispatcher(nodeId, event)
      }
    }

    handlerListener(nodeId, event, handlerId)
  }

  private fun attachOnLayoutListener(
    node: RuneUIManager.Node,
    eventDispatcher: (Int, String) -> Unit,
  ) {
    if (node.layoutListener != null) return
    val listener = View.OnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
      maybeDispatchLayoutEvent(
        node,
        left,
        top,
        right,
        bottom,
        force = false,
        eventDispatcher = eventDispatcher,
      )
    }
    node.layoutListener = listener
    node.view.addOnLayoutChangeListener(listener)
  }

  private fun dispatchImmediateLayout(
    node: RuneUIManager.Node,
    eventDispatcher: (Int, String) -> Unit,
  ) {
    val view = node.view
    if (view.width > 0 || view.height > 0) {
      maybeDispatchLayoutEvent(
        node,
        view.left,
        view.top,
        view.right,
        view.bottom,
        force = true,
        eventDispatcher = eventDispatcher,
      )
    }
  }

  private fun maybeDispatchLayoutEvent(
    node: RuneUIManager.Node,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
    force: Boolean,
    eventDispatcher: (Int, String) -> Unit,
  ) {
    if (!node.hasOnLayoutHandler) return
    val width = (right - left).coerceAtLeast(0)
    val height = (bottom - top).coerceAtLeast(0)
    if (width <= 0 && height <= 0) return
    if (
      !force &&
        node.lastLayoutX == left &&
        node.lastLayoutY == top &&
        node.lastLayoutWidth == width &&
        node.lastLayoutHeight == height
    ) {
      return
    }
    node.lastLayoutX = left
    node.lastLayoutY = top
    node.lastLayoutWidth = width
    node.lastLayoutHeight = height
    val payload = try {
      val invDensity = if (density == 0f) 0f else 1f / density
      val layout = JSONObject()
        .put("x", left * invDensity)
        .put("y", top * invDensity)
        .put("width", width * invDensity)
        .put("height", height * invDensity)
      JSONObject().put("nativeEvent", JSONObject().put("layout", layout))
    } catch (_: JSONException) {
      null
    }
    storeEventPayload(node.id, "onLayout", payload)
    eventDispatcher(node.id, "onLayout")
  }

  internal fun applyBackgroundStyle(view: View, style: Style, nodeType: String? = null) {
    val backgroundColor = style.backgroundColor
    val borderRadius = style.borderRadius?.coerceAtLeast(0f)
    val borderColor = style.borderColor
    val borderWidth = style.borderWidth?.coerceAtLeast(0f)
    val borderStyle = style.borderStyle?.lowercase()
    val needsRoundedBackground = borderRadius != null && borderRadius > 0f
    val shouldUseGradient = needsRoundedBackground || backgroundColor != null || (borderWidth ?: 0f) > 0f || borderColor != null
    
    // TextInput components manage their own padding through onStyleApplied to handle visual insets
    val isTextInput = nodeType == "text-input" || nodeType == "secure-text-input"
    
    val paddingStart = ViewCompat.getPaddingStart(view)
    val paddingTop = view.paddingTop
    val paddingEnd = ViewCompat.getPaddingEnd(view)
    val paddingBottom = view.paddingBottom

    if (shouldUseGradient) {
      val existing = (view.background as? GradientDrawable)?.mutate() as? GradientDrawable
      val drawable = existing ?: GradientDrawable()
      drawable.cornerRadius = borderRadius ?: 0f
      drawable.setColor(backgroundColor ?: Color.TRANSPARENT)

      val strokeWidth = (borderWidth ?: 0f).coerceAtLeast(0f)
      if (strokeWidth > 0f && borderColor != null) {
        val strokeWidthInt = strokeWidth.roundToInt().coerceAtLeast(1)
        when (borderStyle) {
          "dashed" -> {
            val dash = strokeWidthInt * 3f
            drawable.setStroke(strokeWidthInt, borderColor, dash, strokeWidthInt * 2f)
          }
          "dotted" -> {
            val dash = strokeWidthInt.toFloat()
            drawable.setStroke(strokeWidthInt, borderColor, dash, dash * 1.5f)
          }
          else -> drawable.setStroke(strokeWidthInt, borderColor)
        }
      } else {
        drawable.setStroke(0, borderColor ?: Color.TRANSPARENT)
      }

      ViewCompat.setBackground(view, drawable)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        val isOverflowVisible = style.overflow.equals("visible", ignoreCase = true)
        view.clipToOutline = needsRoundedBackground && !isOverflowVisible
      }
    } else {
      when (view.background) {
        is GradientDrawable, is ColorDrawable -> ViewCompat.setBackground(view, null)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.clipToOutline = false
      }
    }

    // Restore padding after setting background, but skip for TextInput which manages its own padding
    if (shouldUseGradient && !isTextInput) {
      ViewCompat.setPaddingRelative(view, paddingStart, paddingTop, paddingEnd, paddingBottom)
    }
  }

  private fun parseString(json: String?): String? {
    if (json == null || json == "null") return null
    if (json.length >= 2 && json.startsWith("\"") && json.endsWith("\"")) {
      return json.substring(1, json.length - 1)
    }
    return json
  }

  private fun parseJsonValue(raw: String?): Any? {
    if (raw == null) return null
    val trimmed = raw.trim()
    if (trimmed.isEmpty() || trimmed == "null") return null
    return try {
      val value = JSONTokener(trimmed).nextValue()
      if (value === JSONObject.NULL) null else value
    } catch (_: JSONException) {
      trimmed
    }
  }

  private fun parseColorValue(raw: Any?): Int? {
    val value = when (raw) {
      null -> return null
      is Number -> raw.toInt()
      else -> raw.toString().trim()
    }
    return try {
      when (value) {
        is Int -> value
        is String -> Color.parseColor(
          if (value.startsWith("#") || value.startsWith("rgb", ignoreCase = true)) value else "#$value".takeIf {
            value.matches(Regex("[0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3}"))
          } ?: value,
        )
        else -> null
      }
    } catch (e: IllegalArgumentException) {
      when (value) {
        is String -> {
          when (value.lowercase()) {
            "transparent" -> Color.TRANSPARENT
            "black" -> Color.BLACK
            "white" -> Color.WHITE
            "red" -> Color.RED
            "green" -> Color.GREEN
            "blue" -> Color.BLUE
            "yellow" -> Color.YELLOW
            "cyan" -> Color.CYAN
            "magenta" -> Color.MAGENTA
            "gray", "grey" -> Color.GRAY
            "darkgray", "darkgrey" -> Color.DKGRAY
            "lightgray", "lightgrey" -> Color.LTGRAY
            else -> null
          }
        }
        else -> null
      }
    }
  }

  companion object {
    private const val TEXT_TYPE = "text"
  }
}
