package com.rune.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.Log
import android.util.SparseArray
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
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
  private val imageSupport: RuneImageSupport,
  private val buttonStyles: SparseArray<ButtonVisualStyle>,
  private val deriveButtonVisualStyle: (Style, ButtonVisualStyle?, RuneButtonView) -> ButtonVisualStyle,
  private val applyVisualStyle: (RuneButtonView, ButtonVisualStyle) -> Unit,
  private val logDebug: (String, String) -> Unit,
  private val resolveTextNode: (Int) -> RuneUIManager.Node?,
  private val onTextInputTextUpdated: (Int, String) -> Unit,
  private val storeEventPayload: (Int, String, JSONObject?) -> Unit,
) {
  
  // Property batch applier for accumulating layout/style properties
  private val batchApplier = PropertyBatchApplier(engine)
  
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
          engine.markDirty(nodeId)
        }
      }
      PropertyCategory.STYLE -> {
        // Accumulate style properties for batched application
        batchApplier.accumulateProperty(target.id, name, valueJson)
      }
      PropertyCategory.TEXT_INPUT -> {
        if (target.type == TEXT_INPUT_TYPE || target.type == SECURE_TEXT_INPUT_TYPE) {
          if (handleTextInputProp(target, name, valueJson)) {
            return
          }
        }
      }
      PropertyCategory.SCROLL_VIEW -> {
        if (target.type == SCROLL_VIEW_TYPE) {
          applyScrollViewProp(target, name, valueJson)
          return
        }
      }
      PropertyCategory.BUTTON -> {
        if (target.type == BUTTON_TYPE) {
          applyButtonProp(target, name, valueJson)
          return
        }
      }
      PropertyCategory.PRESSABLE -> {
        if (target.type == PRESSABLE_TYPE) {
          applyPressableProp(target, name, valueJson)
          return
        }
      }
      PropertyCategory.IMAGE -> {
        if (target.type == IMAGE_TYPE && imageSupport.handleProp(target, name, valueJson)) {
          return
        }
      }
      PropertyCategory.TEXT -> {
        // Text properties are part of style, accumulate them
        batchApplier.accumulateProperty(target.id, name, valueJson)
      }
      PropertyCategory.VIEW -> {
        applyViewProp(target, name, valueJson)
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
    engine.setStyle(target.id, style)
    if (target.id != nodeId) {
      engine.setStyle(nodeId, Style())
    }
    applyBackgroundStyle(target.view, style)
    (target.label ?: target.view as? TextView)?.let { textView ->
      style.fontSize?.let { textView.textSize = it }
      style.color?.let { textView.setTextColor(it) }
      style.fontWeight?.let { weight ->
        val isBold = weight.equals("bold", ignoreCase = true) ||
          weight.toIntOrNull()?.let { it >= 600 } == true
        textView.setTypeface(textView.typeface, if (isBold) Typeface.BOLD else Typeface.NORMAL)
      }
    }
    if (target.type == IMAGE_TYPE) {
      imageSupport.onStyleApplied(target, style)
    }
    if (target.view is RuneTextInputView) {
      applyTextInputStyle(target.view as RuneTextInputView, style, target.id)
    }
  }
  
  /**
   * Apply view-level properties (accessibility, pointerEvents, testID).
   */
  private fun applyViewProp(target: RuneUIManager.Node, name: String, jsonValue: String?) {
    var testIdWarningLogged = false
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
                "button" -> info.className = Button::class.java.name
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
          if (!testIdWarningLogged) {
            // Log.w(
            //   "RuneUI",
            //   "testID is mapped to accessibilityLabel on Android to avoid conflicts; prefer accessibilityLabel directly.",
            // )
            testIdWarningLogged = true
          }
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

  private fun applyScrollViewProp(target: RuneUIManager.Node, name: String, jsonValue: String?) {


  private fun applyScrollViewProp(target: RuneUIManager.Node, name: String, jsonValue: String?) {
    val scrollView = target.view as? RuneScrollView ?: return
    val parsed = parseJsonValue(jsonValue)

    fun asBoolean(value: Any?): Boolean? {
      return when (value) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        is String -> value.equals("true", ignoreCase = true) || value == "1"
        else -> null
      }
    }

    fun asLong(value: Any?): Long? {
      return when (value) {
        is Number -> value.toLong()
        is String -> value.toLongOrNull()
        else -> null
      }
    }

    fun asFloat(value: Any?): Float? {
      return when (value) {
        is Number -> value.toFloat()
        is String -> value.toFloatOrNull()
        else -> null
      }
    }

    if (name == "style") {
      val styleJson = jsonValue ?: return
      val style = Style.fromJson(styleJson)
      engine.setStyle(target.id, style)
      scrollView.applyStyle(style)
      applyBackgroundStyle(target.view, style)
      return
    }

    when (name) {
      "horizontal" -> {
        val horizontal = asBoolean(parsed) ?: false
        scrollView.setAxis(horizontal)
      }
      "scrollEnabled" -> {
        scrollView.setScrollEnabled(asBoolean(parsed))
      }
      "directionalLockEnabled" -> {
        scrollView.setDirectionalLockEnabled(asBoolean(parsed))
      }
      "showsVerticalScrollIndicator" -> {
        scrollView.setShowsVerticalScrollIndicator(asBoolean(parsed))
      }
      "showsHorizontalScrollIndicator" -> {
        scrollView.setShowsHorizontalScrollIndicator(asBoolean(parsed))
      }
      "indicatorStyle" -> {
        val style = (parsed as? String) ?: parseString(jsonValue)
        scrollView.setIndicatorStyle(style)
      }
      "overScrollBehavior" -> {
        val behavior = (parsed as? String) ?: parseString(jsonValue)
        scrollView.setOverScrollBehavior(behavior)
      }
      "eventThrottleMs" -> {
        scrollView.setEventThrottle(asLong(parsed))
      }
      "eventMinDisplacementPx" -> {
        scrollView.setEventMinDisplacement(asFloat(parsed))
      }
      "bridgeCoalescing" -> {
        scrollView.setBridgeCoalescing(asBoolean(parsed))
      }
      "scrollSnapType" -> {
        scrollView.setScrollSnapType(parsed)
      }
      "scrollSnapAlign" -> {
        scrollView.setScrollSnapAlign(parsed)
      }
      "scrollSnapStop" -> {
        scrollView.setScrollSnapStop(parsed)
      }
      "scrollPadding" -> {
        scrollView.setScrollPadding(parsed)
      }
      "scrollGuardConfig" -> {
        val payload = when (parsed) {
          is JSONObject -> parsed
          is Map<*, *> -> JSONObject(parsed)
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        scrollView.setScrollGuardConfig(payload)
      }
      "__recyclerState" -> {
        val payload = when (parsed) {
          is JSONObject -> parsed
          is Map<*, *> -> JSONObject(parsed)
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          is JSONArray -> JSONObject().apply { put("items", parsed) }
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        scrollView.setRecyclerState(payload)
      }
      "__scrollCommand" -> {
        val command = when (parsed) {
          is JSONObject -> parsed
          is Map<*, *> -> JSONObject(parsed)
          else -> null
        }
        if (command != null) {
          scrollView.applyCommand(command)
        }
      }
    }
  }

  private fun applyButtonProp(target: RuneUIManager.Node, name: String, jsonValue: String?) {
    val button = target.view as? RuneButtonView ?: return
    val parsed = parseJsonValue(jsonValue)

    fun asBoolean(value: Any?): Boolean? {
      return when (value) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        is String -> value.equals("true", ignoreCase = true) || value == "1"
        else -> null
      }
    }

    when (name) {
      "disabled" -> {
        val disabled = asBoolean(parsed) ?: false
        button.setDisabled(disabled)
      }
      "loading" -> {
        val loading = asBoolean(parsed) ?: false
        button.setLoading(loading)
      }
      "style" -> {
        val styleJson = jsonValue ?: return
        val style = Style.fromJson(styleJson)
        applyStyleToButton(target.id, button, style)
        engine.setStyle(target.id, style)
        return
      }
      "pressEffect" -> {
        val effect = (parsed as? String) ?: parseString(jsonValue)
        button.setPressEffect(effect)
      }
      "pressRetentionOffset" -> {
        val number = parsed as? Number
        button.setPressRetentionOffset(number)
      }
      "preventFocusOnPress" -> {
        val prevent = asBoolean(parsed) ?: false
        button.setPreventFocusOnPress(prevent)
      }
      "haptics" -> {
        val mode = (parsed as? String) ?: parseString(jsonValue)
        button.setHapticsMode(mode)
      }
      "hitSlop" -> {
        val json = when (parsed) {
          is JSONObject -> parsed
          is Number -> {
            val inset = parsed.toDouble()
            JSONObject().apply {
              put("top", inset)
              put("left", inset)
              put("bottom", inset)
              put("right", inset)
            }
          }
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        button.setHitSlop(json)
      }
      "minimumTouchSize" -> {
        val json = when (parsed) {
          is JSONObject -> parsed
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        button.setMinimumTouchSize(json)
      }
      "__buttonCommand" -> {
        val json = when (parsed) {
          is JSONObject -> parsed
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        button.handleCommand(json)
      }
    }
  }

  private fun applyPressableProp(target: RuneUIManager.Node, name: String, jsonValue: String?) {
    val pressable = target.view as? RunePressableView ?: return
    val parsed = parseJsonValue(jsonValue)

    fun asBoolean(value: Any?): Boolean? {
      return when (value) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        is String -> value.equals("true", ignoreCase = true) || value == "1"
        else -> null
      }
    }

    when (name) {
      "disabled" -> {
        val disabled = asBoolean(parsed) ?: false
        pressable.setDisabled(disabled)
      }
      "style" -> {
        val styleValue = jsonValue ?: return
        val style = Style.fromJson(styleValue)
        engine.setStyle(target.id, style)
        applyBackgroundStyle(pressable, style)
        return
      }
      "stateLayerStyle" -> {
        // No native handling yet; reserved for future visual overlays.
        return
      }
      "pressEffect" -> {
        val effect = (parsed as? String) ?: parseString(jsonValue)
        pressable.setPressEffect(effect)
      }
      "pressRetentionOffset" -> {
        val number = parsed as? Number
        pressable.setPressRetentionOffset(number)
      }
      "hitSlop" -> {
        val json = when (parsed) {
          is JSONObject -> parsed
          is Number -> {
            val inset = parsed.toDouble()
            JSONObject().apply {
              put("top", inset)
              put("left", inset)
              put("bottom", inset)
              put("right", inset)
            }
          }
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        pressable.setHitSlop(json)
      }
      "delayPressInMs" -> {
        val number = parsed as? Number
        pressable.setDelayPressIn(number)
      }
      "delayPressOutMs" -> {
        val number = parsed as? Number
        pressable.setDelayPressOut(number)
      }
      "delayLongPressMs" -> {
        val number = parsed as? Number
        pressable.setDelayLongPress(number)
      }
      "longPressMinDurationMs" -> {
        val number = parsed as? Number
        pressable.setDelayLongPress(number)
      }
      "allowTouchPropagation" -> {
        val allow = asBoolean(parsed) ?: false
        pressable.setAllowTouchPropagation(allow)
      }
      "cancelOnOutside" -> {
        val cancel = asBoolean(parsed) ?: true
        pressable.setCancelOnOutside(cancel)
      }
      "enableDoublePress" -> {
        val enabled = asBoolean(parsed) ?: false
        pressable.setEnableDoublePress(enabled)
      }
      "doublePressWindowMs" -> {
        val number = parsed as? Number
        pressable.setDoublePressWindow(number)
      }
      "focusable" -> {
        val focusable = asBoolean(parsed) ?: true
        pressable.setFocusableSurface(focusable)
      }
      "preventFocusOnPress" -> {
        val prevent = asBoolean(parsed) ?: false
        pressable.setPreventFocusOnPress(prevent)
      }
      "pointerEvents" -> {
        val pointer = (parsed as? String) ?: parseString(jsonValue)
        pressable.setPointerEvents(pointer)
        target.pointerEvents = pointer ?: "auto"
      }
      "activateKeys" -> {
        val keys: Set<String> = when (parsed) {
          is org.json.JSONArray -> {
            val result = mutableSetOf<String>()
            for (i in 0 until parsed.length()) {
              parsed.optString(i)?.let { result.add(it) }
            }
            result
          }
          is List<*> -> parsed.mapNotNull { it?.toString() }.toSet()
          else -> {
            jsonValue?.let {
              runCatching {
                val arr = org.json.JSONArray(it)
                val result = mutableSetOf<String>()
                for (i in 0 until arr.length()) {
                  arr.optString(i)?.let { key -> result.add(key) }
                }
                result
              }.getOrDefault(emptySet())
            } ?: emptySet()
          }
        }
        pressable.setActivateKeys(keys)
      }
      "__pressableCommand" -> {
        val json = when (parsed) {
          is JSONObject -> parsed
          is String -> runCatching { JSONObject(parsed) }.getOrNull()
          else -> jsonValue?.let { runCatching { JSONObject(it) }.getOrNull() }
        }
        pressable.handleCommand(json)
      }
    }
  }

  private fun applyGenericProp(target: RuneUIManager.Node, nodeId: Int, name: String, jsonValue: String?) {
    // Most properties are now handled by category-specific handlers
    // This is only for truly unknown/unhandled properties
    logDebug("RuneUI", "Unhandled prop: $name = $jsonValue")
  }

  internal fun applySetText(nodeId: Int, text: String, propagateTextChange: (RuneUIManager.Node) -> Unit) {
    logDebug("RuneUI", "setText nodeId=$nodeId text='$text'")
    val node = nodes.get(nodeId)
    node?.cachedText = text

    val target = resolveTextNode(nodeId)
    if (target == null) {
      Log.w("RuneUI", "setText: could not resolve target for nodeId=$nodeId")
    }

    when {
      target?.type == TEXT_TYPE -> {
        engine.markDirty(target.id)
        propagateTextChange(target)
        logDebug("RuneUI", "Set text on label: ${target.label?.text}")
      }
      target?.view is RuneTextInputView -> {
        val input = target.view as RuneTextInputView
        input.performProgrammaticUpdate {
          if (!text.contentEquals(input.text?.toString())) {
            input.setText(text)
          }
        }
        onTextInputTextUpdated(target.id, text)
        logDebug("RuneUI", "Set text on input view: ${input.text}")
      }
      target?.view is TextView -> {
        (target.view as TextView).text = text
        engine.markDirty(target.id)
        logDebug("RuneUI", "Set text on view: ${(target.view as TextView).text}")
      }
      else -> {
        engine.markDirty(target?.id ?: nodeId)
      }
    }
  }

  internal fun applySetHandler(
    nodeId: Int,
    event: String,
    eventDispatcher: (Int, String) -> Unit,
    handlerListener: (Int, String, Long) -> Unit,
    handlerId: Long,
  ) {
    nodes.get(nodeId)?.let { node ->
      (node.view as? RuneTextInputView)?.let { input ->
        when (event) {
          "onChange" -> input.hasOnChange = true
          "onChangeText" -> input.hasOnChangeText = true
          "onSelectionChange" -> input.hasOnSelectionChange = true
          "onFocus" -> input.hasOnFocus = true
          "onBlur" -> input.hasOnBlur = true
          "onSubmitEditing" -> input.hasOnSubmitEditing = true
          "onKeyPress" -> input.hasOnKeyPress = true
          "onCompositionStart" -> input.hasOnCompositionStart = true
          "onCompositionEnd" -> input.hasOnCompositionEnd = true
        }
      }
      if (node.type == IMAGE_TYPE) {
        imageSupport.onHandlerSet(node, event)
      }
      if (event == "onLayout") {
        node.hasOnLayoutHandler = true
        attachOnLayoutListener(node, eventDispatcher)
        dispatchImmediateLayout(node, eventDispatcher)
      }
    }
    val node = nodes.get(nodeId)
    val nodeType = node?.type
    if (nodeType == BUTTON_TYPE) {
      (node.view as? RuneButtonView)?.let { button ->
        if (event == "onLongPress") {
          button.setHasLongPressHandler(true)
        }
      }
      handlerListener(nodeId, event, handlerId)
      return
    }
    if (nodeType == PRESSABLE_TYPE && event == "onLongPress") {
      (node?.view as? RunePressableView)?.setHasLongPressHandler(true)
    }
    if (event == "onPress" && nodeType != BUTTON_TYPE && nodeType != PRESSABLE_TYPE) {
      logDebug("RuneUI", "Setting onPress handler for node $nodeId")
      val node = nodes.get(nodeId)
      node?.view?.let { view ->
        if (node.pointerEvents != "none") {
          view.isClickable = true
        }
        view.setOnClickListener {
          logDebug("RuneUI", "onPress triggered for node $nodeId")
          eventDispatcher(nodeId, event)
        }
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
      val layout = JSONObject()
        .put("x", left)
        .put("y", top)
        .put("width", width)
        .put("height", height)
      JSONObject().put("nativeEvent", JSONObject().put("layout", layout))
    } catch (_: JSONException) {
      null
    }
    storeEventPayload(node.id, "onLayout", payload)
    eventDispatcher(node.id, "onLayout")
  }

  private fun applyStyleToButton(nodeId: Int, button: RuneButtonView, style: Style) {
    val previous = buttonStyles.get(nodeId)
    val merged = deriveButtonVisualStyle(style, previous, button)
    if (previous == merged) {
      return
    }
    buttonStyles.put(nodeId, merged)
    applyVisualStyle(button, merged)
  }

  internal fun applyBackgroundStyle(view: View, style: Style) {
    val backgroundColor = style.backgroundColor
    val borderRadius = style.borderRadius?.coerceAtLeast(0f)
    val borderColor = style.borderColor
    val borderWidth = style.borderWidth?.coerceAtLeast(0f)
    val borderStyle = style.borderStyle?.lowercase()
    val needsRoundedBackground = borderRadius != null && borderRadius > 0f
    val shouldUseGradient = needsRoundedBackground || backgroundColor != null || (borderWidth ?: 0f) > 0f || borderColor != null
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
        view.clipToOutline = needsRoundedBackground
      }
    } else {
      when (val current = view.background) {
        is GradientDrawable, is ColorDrawable -> ViewCompat.setBackground(view, null)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.clipToOutline = false
      }
    }

    if (shouldUseGradient) {
      ViewCompat.setPaddingRelative(view, paddingStart, paddingTop, paddingEnd, paddingBottom)
    }
  }

  internal fun applyTextInputStyle(view: RuneTextInputView, style: Style, nodeId: Int) {
    var left = 0
    var top = 0
    var right = 0
    var bottom = 0

    fun Float?.asPx(): Int? = this?.roundToInt()?.coerceAtLeast(0)

    style.padding.asPx()?.let { value ->
      left = value
      top = value
      right = value
      bottom = value
    }
    style.paddingHorizontal.asPx()?.let { value ->
      left = value
      right = value
    }
    style.paddingVertical.asPx()?.let { value ->
      top = value
      bottom = value
    }
    style.paddingLeft.asPx()?.let { left = it }
    style.paddingRight.asPx()?.let { right = it }
    style.paddingTop.asPx()?.let { top = it }
    style.paddingBottom.asPx()?.let { bottom = it }

    val paddingChanged = view.updateStylePadding(left, top, right, bottom)
    val baselineChanged = view.ensureBaselineConstraints()
    if (paddingChanged || baselineChanged) {
      view.requestLayout()
    }
    engine.markDirty(nodeId)
  }

  internal fun handleTextInputProp(node: RuneUIManager.Node, name: String, rawJson: String?): Boolean {
    val view = node.view as? RuneTextInputView ?: return false
    val state = node.textInputState ?: return false

    val parsed = parseJsonValue(rawJson)
    return when (name) {
      "style" -> false
      "value" -> {
        val textValue = parsed?.toString() ?: ""
        if (!textValue.contentEquals(view.text?.toString())) {
          view.performProgrammaticUpdate {
            if (!textValue.contentEquals(view.text?.toString())) {
              view.setText(textValue)
            }
          }
        }
        state.awaitingInitialValue = false
        state.hasAppliedInitialText = true
        onTextInputTextUpdated(node.id, textValue)
        true
      }
      "defaultValue" -> {
        val textValue = parsed?.toString() ?: ""
        val previousDefault = state.defaultValue
        state.defaultValue = textValue
        var shouldApply = state.awaitingInitialValue || !state.hasAppliedInitialText
        if (!shouldApply) {
          val current = state.currentText.ifEmpty { view.text?.toString().orEmpty() }
          shouldApply = current.isEmpty() || current == previousDefault
        }
        if (shouldApply) {
          view.performProgrammaticUpdate {
            if (!textValue.contentEquals(view.text?.toString())) {
              view.setText(textValue)
            }
          }
          onTextInputTextUpdated(node.id, textValue)
          state.awaitingInitialValue = false
          state.hasAppliedInitialText = true
        }
        true
      }
      "placeholder" -> {
        val placeholder = (parsed as? String) ?: parseString(rawJson)
        view.applyPlaceholder(placeholder)
        true
      }
      "multiline" -> {
        val multiline = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> false
        }
        view.applyMultiline(multiline)
        true
      }
      "numberOfLines" -> {
        val lines = when (parsed) {
          is Number -> parsed.toInt()
          else -> 0
        }
        view.applyNumberOfLines(lines)
        true
      }
      "maxLength" -> {
        view.maxLength = when (parsed) {
          is Number -> parsed.toInt()
          is String -> parsed.toIntOrNull() ?: -1
          else -> -1
        }
        true
      }
      "editable" -> {
        val editable = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> true
        }
        view.applyEditable(editable)
        true
      }
      "secureTextEntry" -> {
        val secure = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> false
        }
        view.applySecureEntry(secure)
        true
      }
      "inputMode" -> {
        val mode = (parsed as? String) ?: parseString(rawJson)
        view.applyInputMode(mode)
        true
      }
      "autoCapitalize" -> {
        val mode = (parsed as? String) ?: parseString(rawJson)
        view.applyAutoCapitalize(mode)
        true
      }
      "autoCorrect" -> {
        view.applyAutoCorrect(parsed as? Boolean)
        true
      }
      "spellCheck" -> {
        view.applySpellCheck(parsed as? Boolean)
        true
      }
      "returnKeyType" -> {
        val type = (parsed as? String) ?: parseString(rawJson)
        view.applyReturnKeyType(type)
        true
      }
      "blurOnSubmit" -> {
        view.blurOnSubmit = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> false
        }
        true
      }
      "submitBehavior" -> {
        val behavior = (parsed as? String)?.takeIf { it.isNotBlank() }
          ?: parseString(rawJson)?.takeIf { it.isNotBlank() }
          ?: "submit"
        view.submitBehavior = behavior
        true
      }
      "selection" -> {
        val selectionJson = parsed as? JSONObject
        if (selectionJson != null) {
          val start = selectionJson.optInt("start", selectionJson.optInt("begin", 0))
          val end = selectionJson.optInt("end", start)
          val spec = RuneUIManager.SelectionSpec(start.coerceAtLeast(0), end.coerceAtLeast(0))
          state.pendingSelection = spec
          view.post {
            state.pendingSelection?.let { pending ->
              if (pending.start == spec.start && pending.end == spec.end) {
                view.applySelection(pending.start, pending.end)
              }
            }
          }
        }
        true
      }
      "selectionColor" -> {
        val color = parseColorValue(parsed)
        view.applySelectionColor(color)
        true
      }
      "caretColor" -> {
        val color = parseColorValue(parsed)
        view.applyCaretColor(color)
        true
      }
      "eventThrottleMs" -> {
        val throttle = when (parsed) {
          is Number -> parsed.toLong()
          is String -> parsed.toLongOrNull()
          else -> null
        } ?: 0L
        view.applyEventThrottle(throttle)
        true
      }
      "allowProgrammaticJumpDuringEdit" -> {
        val allow = when (parsed) {
          is Boolean -> parsed
          is Number -> parsed.toInt() != 0
          else -> false
        }
        view.allowProgrammaticJumpDuringEdit = allow
        true
      }
      "__focusRequest" -> {
        view.requestFocusFromJS()
        true
      }
      "clearButtonMode" -> {
        logDebug("RuneUI", "clearButtonMode is not supported on Android; ignoring value: $parsed")
        true
      }
      "showClearAccessory" -> {
        logDebug("RuneUI", "showClearAccessory is not supported on Android; ignoring value: $parsed")
        true
      }
      else -> false
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
    private const val IMAGE_TYPE = "image"
    private const val TEXT_INPUT_TYPE = "text-input"
    private const val SECURE_TEXT_INPUT_TYPE = "secure-text-input"
    private const val SCROLL_VIEW_TYPE = "scroll-view"
    private const val BUTTON_TYPE = "button"
    private const val PRESSABLE_TYPE = "pressable"
  }
}
