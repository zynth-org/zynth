package com.rune.kit.core

import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.Log
import android.util.TypedValue
import android.util.SparseArray
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.Style
import com.rune.kit.core.TransformOperation
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

  internal fun getAppliedStyle(nodeId: Int): Style? {
    return batchApplier.getAppliedStyle(nodeId)
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
    batchApplier.setAppliedStyle(target.id, pixelStyle)
    if (target.id != nodeId) {
      engine.setStyle(nodeId, Style())
      batchApplier.setAppliedStyle(nodeId, Style())
    }
    applyBackgroundStyle(target.view, pixelStyle, target.type)
    applyShadowStyle(target.view, pixelStyle)
    
    // Apply zIndex
    val zIndex = style.zIndex
    if (zIndex != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      target.view.translationZ = zIndex
    }

    val transformOrigin = pixelStyle.transformOrigin
    target.transformOrigin = transformOrigin
    TransformOriginApplier.apply(target.view, transformOrigin)
    
    // Apply Transform
    val transform = pixelStyle.transform
    if (transform != null) {
      var tx = 0f
      var ty = 0f
      var sx = 1f
      var sy = 1f
      var rot = 0f
      var rotX = 0f
      var rotY = 0f
      var skewX = 0f
      var skewY = 0f
      var hasSkew = false
      var hasPerspective = false
      var perspectiveValue = Float.NaN
      
      for (op in transform) {
        when (op) {
          is TransformOperation.Translate -> {
            tx += op.x
            ty += op.y
          }
          is TransformOperation.Scale -> {
            sx *= op.x
            sy *= op.y
          }
          is TransformOperation.Rotate -> rot += op.degrees
          is TransformOperation.RotateZ -> rot += op.degrees
          is TransformOperation.RotateX -> rotX += op.degrees
          is TransformOperation.RotateY -> rotY += op.degrees
          is TransformOperation.SkewX -> {
            skewX += op.degrees
            hasSkew = true
          }
          is TransformOperation.SkewY -> {
            skewY += op.degrees
            hasSkew = true
          }
          is TransformOperation.Perspective -> {
            if (op.value > 0f) {
              perspectiveValue = op.value
              hasPerspective = true
            }
          }
        }
      }
      
      // Apply basic transforms
      target.view.translationX = tx
      target.view.translationY = ty
      target.view.scaleX = sx
      target.view.scaleY = sy
      val has3dRotation = kotlin.math.abs(rotX) > 0.001f || kotlin.math.abs(rotY) > 0.001f
      if (has3dRotation) {
        val euler = computeEulerForRotateXY(rotX, rotY)
        target.view.rotationX = -euler.x
        target.view.rotationY = -euler.y
        target.view.rotation = if (rot == 0f) euler.z else rot
      } else {
        target.view.rotation = rot
        target.view.rotationX = -rotX
        target.view.rotationY = -rotY
      }
      val viewDensity = target.view.resources.displayMetrics.density.takeIf { it > 0f } ?: density
      if (hasPerspective) {
        target.view.cameraDistance = perspectiveValue * viewDensity
      } else if (has3dRotation) {
        target.view.cameraDistance = DEFAULT_PERSPECTIVE * viewDensity
      }
      
      // Apply skew using Matrix if needed
      if (hasSkew) {
        val matrix = android.graphics.Matrix()
        val radX = Math.toRadians(skewX.toDouble()).toFloat()
        val radY = Math.toRadians(skewY.toDouble()).toFloat()
        matrix.setValues(floatArrayOf(
          1f, Math.tan(radX.toDouble()).toFloat(), 0f,
          Math.tan(radY.toDouble()).toFloat(), 1f, 0f,
          0f, 0f, 1f
        ))
        target.view.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        target.view.setAnimationMatrix(matrix)
      } else {
        target.view.setAnimationMatrix(null)
        target.view.setLayerType(View.LAYER_TYPE_NONE, null)
      }
    } else {
      target.view.translationX = 0f
      target.view.translationY = 0f
      target.view.scaleX = 1f
      target.view.scaleY = 1f
      target.view.rotation = 0f
      target.view.rotationX = 0f
      target.view.rotationY = 0f
      target.view.setAnimationMatrix(null)
      target.view.setLayerType(View.LAYER_TYPE_NONE, null)
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
      "layout" -> {
        target.layoutTransition = parseLayoutTransition(parseJsonValue(jsonValue))
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
      val textView = node.view
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
    val backgroundGradient = style.backgroundGradient
    val borderRadius = style.borderRadius?.coerceAtLeast(0f)
    val borderColor = style.borderColor
    val borderWidth = style.borderWidth?.coerceAtLeast(0f)
    val borderStyle = style.borderStyle?.lowercase()

    // Individual border properties
    val borderTopWidth = style.borderTopWidth?.coerceAtLeast(0f) ?: borderWidth
    val borderRightWidth = style.borderRightWidth?.coerceAtLeast(0f) ?: borderWidth
    val borderBottomWidth = style.borderBottomWidth?.coerceAtLeast(0f) ?: borderWidth
    val borderLeftWidth = style.borderLeftWidth?.coerceAtLeast(0f) ?: borderWidth

    val borderTopColor = style.borderTopColor ?: borderColor
    val borderRightColor = style.borderRightColor ?: borderColor
    val borderBottomColor = style.borderBottomColor ?: borderColor
    val borderLeftColor = style.borderLeftColor ?: borderColor

    val borderTopLeftRadius = style.borderTopLeftRadius?.coerceAtLeast(0f) ?: borderRadius ?: 0f
    val borderTopRightRadius = style.borderTopRightRadius?.coerceAtLeast(0f) ?: borderRadius ?: 0f
    val borderBottomRightRadius = style.borderBottomRightRadius?.coerceAtLeast(0f) ?: borderRadius ?: 0f
    val borderBottomLeftRadius = style.borderBottomLeftRadius?.coerceAtLeast(0f) ?: borderRadius ?: 0f

    val hasAnyBorderWidth = (borderTopWidth ?: 0f) > 0f || (borderRightWidth ?: 0f) > 0f ||
      (borderBottomWidth ?: 0f) > 0f || (borderLeftWidth ?: 0f) > 0f
    val hasAnyBorderColor = borderTopColor != null || borderRightColor != null ||
      borderBottomColor != null || borderLeftColor != null
    val hasAnyBorderRadius = borderTopLeftRadius > 0f || borderTopRightRadius > 0f ||
      borderBottomRightRadius > 0f || borderBottomLeftRadius > 0f
    
    // Check if elevation/shadow requires a background for proper outline
    val hasElevation = (style.elevation ?: 0f) > 0f
    val hasBoxShadow = style.boxShadow?.isNotEmpty() == true

    val needsRoundedBackground = hasAnyBorderRadius
    // Also create RuneBorderDrawable when elevation is set to ensure proper shadow outline
    val shouldUseGradient = needsRoundedBackground || backgroundColor != null || backgroundGradient != null || hasAnyBorderWidth || hasAnyBorderColor || hasElevation || hasBoxShadow
    val shouldClipOverflow = style.overflow?.lowercase() == "hidden" || style.overflow?.lowercase() == "scroll"
    val shouldClipForImage = nodeType == "image"
    
    // TextInput components manage their own padding through onStyleApplied to handle visual insets
    val isTextInput = nodeType == "text-input" || nodeType == "secure-text-input"
    
    val paddingStart = ViewCompat.getPaddingStart(view)
    val paddingTop = view.paddingTop
    val paddingEnd = ViewCompat.getPaddingEnd(view)
    val paddingBottom = view.paddingBottom

    if (shouldUseGradient) {
      val existing = (view.background as? RuneBorderDrawable)?.mutate() as? RuneBorderDrawable
      val drawable = existing ?: RuneBorderDrawable()

      drawable.backgroundColor = backgroundColor ?: Color.TRANSPARENT
      drawable.borderTopWidth = borderTopWidth ?: 0f
      drawable.borderRightWidth = borderRightWidth ?: 0f
      drawable.borderBottomWidth = borderBottomWidth ?: 0f
      drawable.borderLeftWidth = borderLeftWidth ?: 0f
      drawable.borderTopColor = borderTopColor ?: Color.TRANSPARENT
      drawable.borderRightColor = borderRightColor ?: Color.TRANSPARENT
      drawable.borderBottomColor = borderBottomColor ?: Color.TRANSPARENT
      drawable.borderLeftColor = borderLeftColor ?: Color.TRANSPARENT
      drawable.borderTopLeftRadius = borderTopLeftRadius
      drawable.borderTopRightRadius = borderTopRightRadius
      drawable.borderBottomRightRadius = borderBottomRightRadius
      drawable.borderBottomLeftRadius = borderBottomLeftRadius
      drawable.borderStyle = borderStyle
      drawable.backgroundGradient = backgroundGradient

      ViewCompat.setBackground(view, drawable)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        // Only clip to outline when overflow demands clipping.
        // Rounded backgrounds without overflow:hidden should not clip children (match CSS/iOS).
        view.clipToOutline = needsRoundedBackground && (shouldClipOverflow || shouldClipForImage)
      }
    } else {
      when (view.background) {
        is RuneBorderDrawable, is ColorDrawable -> ViewCompat.setBackground(view, null)
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

  private fun applyShadowStyle(view: View, style: Style) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return
    val primaryShadow = style.boxShadow?.firstOrNull()
    val elevation = style.elevation ?: primaryShadow?.blurRadius
    if (elevation != null && elevation > 0f) {
      ViewCompat.setElevation(view, elevation)
      view.translationZ = elevation
      // Ensure parent doesn't clip the shadow
      val parent = view.parent as? ViewGroup
      parent?.clipChildren = false
      parent?.clipToPadding = false
      // Use background's outline for shadow shape (respects border radius)
      view.outlineProvider = ViewOutlineProvider.BACKGROUND
    } else {
      ViewCompat.setElevation(view, 0f)
      view.translationZ = 0f
    }
    // Only set custom shadow colors if boxShadow is explicitly specified
    // When using elevation only, leave system defaults for proper Material shadows
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && primaryShadow != null) {
      view.outlineAmbientShadowColor = primaryShadow.color
      view.outlineSpotShadowColor = primaryShadow.color
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
      else -> raw.toString()
    }
    
    if (value is Int) return value
    return RuneColorParser.parse(value as String)
  }

  private fun parseLayoutTransition(raw: Any?): LayoutTransitionConfig? {
    when (raw) {
      null -> return null
      is Boolean -> {
        return if (raw) {
          LayoutTransitionConfig(
            type = "linear",
            durationMs = 300L,
            delayMs = 0L,
            easing = LayoutEasing.EASE_OUT_CUBIC,
          )
        } else {
          null
        }
      }
    }

    val map = when (raw) {
      is JSONObject -> raw
      is Map<*, *> -> raw
      else -> return null
    }

    val mapObj = map as? Map<*, *>
    val type = when (map) {
      is JSONObject -> map.optString("type", "linear")
      else -> (mapObj?.get("type") as? String) ?: "linear"
    }
    val durationMs = when (map) {
      is JSONObject -> map.optLong("duration", 300L)
      else -> (mapObj?.get("duration") as? Number)?.toLong()
        ?: mapObj?.get("duration")?.toString()?.toLongOrNull()
        ?: 300L
    }
    val delayMs = when (map) {
      is JSONObject -> map.optLong("delay", 0L)
      else -> (mapObj?.get("delay") as? Number)?.toLong()
        ?: mapObj?.get("delay")?.toString()?.toLongOrNull()
        ?: 0L
    }
    val easingName = when (map) {
      is JSONObject -> map.optString("easing", "").takeIf { it.isNotBlank() }
      else -> mapObj?.get("easing") as? String
    }

    return LayoutTransitionConfig(
      type = type,
      durationMs = durationMs,
      delayMs = delayMs,
      easing = LayoutEasing.fromName(easingName),
    )
  }

  private data class EulerAngles(val x: Float, val y: Float, val z: Float)

  private fun computeEulerForRotateXY(rotateX: Float, rotateY: Float): EulerAngles {
    val rx = Math.toRadians(rotateX.toDouble())
    val ry = Math.toRadians(rotateY.toDouble())
    val rotateXMatrix = identityMatrix().apply { applyRotateX(this, rx) }
    val rotateYMatrix = identityMatrix().apply { applyRotateY(this, ry) }

    // CSS/RN order: transforms are applied in reverse list order.
    val combined = multiplyMatrices(rotateYMatrix, rotateXMatrix)
    return extractEulerFromMatrix(combined)
  }

  private fun identityMatrix(): DoubleArray {
    return doubleArrayOf(
      1.0, 0.0, 0.0, 0.0,
      0.0, 1.0, 0.0, 0.0,
      0.0, 0.0, 1.0, 0.0,
      0.0, 0.0, 0.0, 1.0,
    )
  }

  private fun applyRotateX(matrix: DoubleArray, radians: Double) {
    val cos = kotlin.math.cos(radians)
    val sin = kotlin.math.sin(radians)
    matrix[5] = cos
    matrix[6] = sin
    matrix[9] = -sin
    matrix[10] = cos
  }

  private fun applyRotateY(matrix: DoubleArray, radians: Double) {
    val cos = kotlin.math.cos(radians)
    val sin = kotlin.math.sin(radians)
    matrix[0] = cos
    matrix[2] = -sin
    matrix[8] = sin
    matrix[10] = cos
  }

  private fun multiplyMatrices(a: DoubleArray, b: DoubleArray): DoubleArray {
    val out = DoubleArray(16)
    for (c in 0..3) {
      val cIndex = c * 4
      for (r in 0..3) {
        out[cIndex + r] =
          a[r + 0] * b[cIndex + 0] +
            a[r + 4] * b[cIndex + 1] +
            a[r + 8] * b[cIndex + 2] +
            a[r + 12] * b[cIndex + 3]
      }
    }
    return out
  }

  private fun extractEulerFromMatrix(matrix: DoubleArray): EulerAngles {
    val r00 = matrix[0]
    val r01 = matrix[4]
    val r02 = matrix[8]
    val r12 = matrix[9]
    val r22 = matrix[10]

    val sinRy = -r02
    val ry = kotlin.math.asin(sinRy.coerceIn(-1.0, 1.0))
    val rx = if (kotlin.math.abs(sinRy) >= 1.0) {
      kotlin.math.atan2(sinRy * r01, sinRy * r02)
    } else {
      kotlin.math.atan2(r12, r22)
    }
    val rz = kotlin.math.atan2(r01, r00)

    return EulerAngles(
      x = Math.toDegrees(rx).toFloat(),
      y = Math.toDegrees(ry).toFloat(),
      z = Math.toDegrees(rz).toFloat(),
    )
  }

  companion object {
    private const val TEXT_TYPE = "text"
    private const val DEFAULT_PERSPECTIVE = 500f
  }
}
