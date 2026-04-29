package com.zynth.kit.core

import android.graphics.Matrix
import android.os.Build
import android.view.View
import android.widget.TextView

internal data class ZynthViewStyleState(
  var borderDrawable: ZynthBorderDrawable? = null,
  var shadowLayers: List<ShadowLayer>? = null,
  var shadowColor: Int? = null,
  var shadowOpacity: Float? = null,
  var shadowRadius: Float? = null,
  var shadowOffsetX: Float? = null,
  var shadowOffsetY: Float? = null,
  var zIndex: Float = 0f,
  var transformOps: List<TransformOperation>? = null,
  var transformOrigin: Pair<OriginValue, OriginValue>? = null,
)

internal data class OriginValue(val value: Float, val isPercent: Boolean)

internal fun ZynthUIManager.applyStyleProp(id: Int, view: View, name: String, value: Double): Boolean {
  val isTextNode = view is TextView && nodeStates[id]?.type == "text"
  val floatVal = value.toFloat()
  when (name) {
    "borderWidth" -> {
      val width = dpToPx(floatVal)
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopWidth = width
      drawable.borderRightWidth = width
      drawable.borderBottomWidth = width
      drawable.borderLeftWidth = width
      styleDirtyNodes.add(id)
      return true
    }
    "borderRadius" -> {
      val radius = dpToPx(floatVal)
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopLeftRadius = radius
      drawable.borderTopRightRadius = radius
      drawable.borderBottomRightRadius = radius
      drawable.borderBottomLeftRadius = radius
      (view as? ZynthLayoutView)?.setBorderRadii(radius, radius, radius, radius)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderTopWidth" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopWidth = dpToPx(floatVal)
      styleDirtyNodes.add(id)
      return true
    }
    "borderRightWidth" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderRightWidth = dpToPx(floatVal)
      styleDirtyNodes.add(id)
      return true
    }
    "borderBottomWidth" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderBottomWidth = dpToPx(floatVal)
      styleDirtyNodes.add(id)
      return true
    }
    "borderLeftWidth" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderLeftWidth = dpToPx(floatVal)
      styleDirtyNodes.add(id)
      return true
    }
    "borderTopLeftRadius" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopLeftRadius = dpToPx(floatVal)
      (view as? ZynthLayoutView)?.setBorderRadii(
        drawable.borderTopLeftRadius,
        drawable.borderTopRightRadius,
        drawable.borderBottomRightRadius,
        drawable.borderBottomLeftRadius
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderTopRightRadius" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopRightRadius = dpToPx(floatVal)
      (view as? ZynthLayoutView)?.setBorderRadii(
        drawable.borderTopLeftRadius,
        drawable.borderTopRightRadius,
        drawable.borderBottomRightRadius,
        drawable.borderBottomLeftRadius
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderBottomRightRadius" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderBottomRightRadius = dpToPx(floatVal)
      (view as? ZynthLayoutView)?.setBorderRadii(
        drawable.borderTopLeftRadius,
        drawable.borderTopRightRadius,
        drawable.borderBottomRightRadius,
        drawable.borderBottomLeftRadius
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderBottomLeftRadius" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderBottomLeftRadius = dpToPx(floatVal)
      (view as? ZynthLayoutView)?.setBorderRadii(
        drawable.borderTopLeftRadius,
        drawable.borderTopRightRadius,
        drawable.borderBottomRightRadius,
        drawable.borderBottomLeftRadius
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "elevation" -> {
      view.elevation = dpToPx(floatVal)
      return true
    }
    "zIndex" -> {
      val state = styleStates.getOrPut(id) { ZynthViewStyleState() }
      state.zIndex = floatVal
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        // zIndex controls stacking only; do not map to native Z to avoid implicit shadows.
        view.translationZ = 0f
      }
      reorderParentChildrenByZIndex(id)
      return true
    }
    "opacity" -> {
      view.alpha = floatVal
      return true
    }
  }

  if (view is TextView) {
    if (isTextNode) {
      when (name) {
        "lineHeight",
        "lineSpacing",
        "paragraphSpacing",
        "baselineShift",
        "letterSpacing",
        "minimumFontScale",
        "textDecorationLine",
        "textTransform",
        "hyphenation",
        "fontSize" -> {
          return true
        }
      }
    }
    val textState = textStyleStates.getOrPut(id) { ZynthTextStyleState() }
    when (name) {
      "lineHeight" -> {
        textState.lineHeight = dpToPx(floatVal)
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "lineSpacing" -> {
        textState.lineSpacing = dpToPx(floatVal)
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "paragraphSpacing" -> {
        textState.paragraphSpacing = dpToPx(floatVal)
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "baselineShift" -> {
        textState.baselineShift = dpToPx(floatVal)
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "letterSpacing" -> {
        textState.letterSpacing = dpToPx(floatVal)
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "minimumFontScale" -> {
        textState.minimumFontScale = floatVal
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "fontSize" -> {
        view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, dpToPx(floatVal))
        return true
      }
    }
  }

  return false
}

internal fun ZynthUIManager.applyStyleProp(id: Int, view: View, name: String, value: String?): Boolean {
  if (value == null) return false
  val isTextNode = view is TextView && nodeStates[id]?.type == "text"
  val state = styleStates.getOrPut(id) { ZynthViewStyleState() }
  when (name) {
    "background", "backgroundImage" -> {
      val gradient = ZynthGradientParser.parse(value)
      val drawable = ensureBorderDrawable(id, view)
      val color = ZynthColorParser.parse(value)
      if (gradient != null) {
        drawable.backgroundGradient = gradient
      } else {
        drawable.backgroundGradient = null
        color?.let { drawable.backgroundColor = it }
      }
      
      // If this is a surface root node, also apply to the surface root view itself
      if (surfaceRoots.containsKey(id)) {
        surfaceRoots[id]?.let { root ->
          if (root !== view) {
            val rootDrawable = (root.background as? ZynthBorderDrawable) ?: ZynthBorderDrawable().also { root.background = it }
            rootDrawable.backgroundGradient = drawable.backgroundGradient
            rootDrawable.backgroundColor = drawable.backgroundColor
          }
        }
      }

      styleDirtyNodes.add(id)
      return true
    }
    "backgroundColor" -> {
      val drawable = ensureBorderDrawable(id, view)
      val color = ZynthColorParser.parse(value)
      if (color != null) {
        drawable.backgroundColor = color
        
        // If this is a surface root node, also apply to the surface root view itself
        if (surfaceRoots.containsKey(id)) {
           surfaceRoots[id]?.let { root ->
              if (root !== view) {
                 val rootDrawable = (root.background as? ZynthBorderDrawable) ?: ZynthBorderDrawable().also { root.background = it }
                 rootDrawable.backgroundColor = color
              }
           }
        }
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderWidth" -> {
      val width = dpToPx(value.toFloatOrNull() ?: 0f)
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopWidth = width
      drawable.borderRightWidth = width
      drawable.borderBottomWidth = width
      drawable.borderLeftWidth = width
      styleDirtyNodes.add(id)
      return true
    }
    "borderColor" -> {
      val color = ZynthColorParser.parse(value) ?: return true
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopColor = color
      drawable.borderRightColor = color
      drawable.borderBottomColor = color
      drawable.borderLeftColor = color
      styleDirtyNodes.add(id)
      return true
    }
    "borderRadius" -> {
      val radius = dpToPx(value.toFloatOrNull() ?: 0f)
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopLeftRadius = radius
      drawable.borderTopRightRadius = radius
      drawable.borderBottomRightRadius = radius
      drawable.borderBottomLeftRadius = radius
      (view as? ZynthLayoutView)?.setBorderRadii(radius, radius, radius, radius)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderTopWidth" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopWidth = dpToPx(value.toFloatOrNull() ?: 0f)
      styleDirtyNodes.add(id)
      return true
    }
    "borderRightWidth" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderRightWidth = dpToPx(value.toFloatOrNull() ?: 0f)
      styleDirtyNodes.add(id)
      return true
    }
    "borderBottomWidth" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderBottomWidth = dpToPx(value.toFloatOrNull() ?: 0f)
      styleDirtyNodes.add(id)
      return true
    }
    "borderLeftWidth" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderLeftWidth = dpToPx(value.toFloatOrNull() ?: 0f)
      styleDirtyNodes.add(id)
      return true
    }
    "borderTopColor" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopColor = ZynthColorParser.parse(value) ?: drawable.borderTopColor
      styleDirtyNodes.add(id)
      return true
    }
    "borderRightColor" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderRightColor = ZynthColorParser.parse(value) ?: drawable.borderRightColor
      styleDirtyNodes.add(id)
      return true
    }
    "borderBottomColor" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderBottomColor = ZynthColorParser.parse(value) ?: drawable.borderBottomColor
      styleDirtyNodes.add(id)
      return true
    }
    "borderLeftColor" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderLeftColor = ZynthColorParser.parse(value) ?: drawable.borderLeftColor
      styleDirtyNodes.add(id)
      return true
    }
    "borderTopLeftRadius" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopLeftRadius = dpToPx(value.toFloatOrNull() ?: 0f)
      (view as? ZynthLayoutView)?.setBorderRadii(
        drawable.borderTopLeftRadius,
        drawable.borderTopRightRadius,
        drawable.borderBottomRightRadius,
        drawable.borderBottomLeftRadius
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderTopRightRadius" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderTopRightRadius = dpToPx(value.toFloatOrNull() ?: 0f)
      (view as? ZynthLayoutView)?.setBorderRadii(
        drawable.borderTopLeftRadius,
        drawable.borderTopRightRadius,
        drawable.borderBottomRightRadius,
        drawable.borderBottomLeftRadius
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderBottomRightRadius" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderBottomRightRadius = dpToPx(value.toFloatOrNull() ?: 0f)
      (view as? ZynthLayoutView)?.setBorderRadii(
        drawable.borderTopLeftRadius,
        drawable.borderTopRightRadius,
        drawable.borderBottomRightRadius,
        drawable.borderBottomLeftRadius
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderBottomLeftRadius" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderBottomLeftRadius = dpToPx(value.toFloatOrNull() ?: 0f)
      (view as? ZynthLayoutView)?.setBorderRadii(
        drawable.borderTopLeftRadius,
        drawable.borderTopRightRadius,
        drawable.borderBottomRightRadius,
        drawable.borderBottomLeftRadius
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        view.invalidateOutline()
      }
      styleDirtyNodes.add(id)
      return true
    }
    "borderStyle" -> {
      val drawable = ensureBorderDrawable(id, view)
      drawable.borderStyle = value
      styleDirtyNodes.add(id)
      return true
    }
    "shadowColor" -> {
      state.shadowColor = ZynthColorParser.parse(value)
      applyShadow(this, view, state)
      return true
    }
    "shadowOpacity" -> {
      state.shadowOpacity = value.toFloatOrNull()
      applyShadow(this, view, state)
      return true
    }
    "shadowRadius" -> {
      state.shadowRadius = dpToPx(value.toFloatOrNull() ?: 0f)
      applyShadow(this, view, state)
      return true
    }
    "shadowOffset" -> {
      val trimmed = value.trim()
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        runCatching { org.json.JSONArray(trimmed) }.getOrNull()?.let { arr ->
          state.shadowOffsetX = dpToPx(arr.optDouble(0, 0.0).toFloat())
          state.shadowOffsetY = dpToPx(arr.optDouble(1, 0.0).toFloat())
        } ?: runCatching { org.json.JSONObject(trimmed) }.getOrNull()?.let { obj ->
          state.shadowOffsetX = dpToPx(obj.optDouble("width", 0.0).toFloat())
          state.shadowOffsetY = dpToPx(obj.optDouble("height", 0.0).toFloat())
        }
      } else {
        val parts = trimmed.replace(",", " ").split(" ").filter { it.isNotBlank() }
        state.shadowOffsetX = parts.getOrNull(0)?.toFloatOrNull()?.let { dpToPx(it) }
        state.shadowOffsetY = parts.getOrNull(1)?.toFloatOrNull()?.let { dpToPx(it) }
      }
      applyShadow(this, view, state)
      return true
    }
    "boxShadow" -> {
      state.shadowLayers = ZynthShadowParser.parse(value)
      applyShadow(this, view, state)
      return true
    }
    "elevation" -> {
      view.elevation = dpToPx(value.toFloatOrNull() ?: 0f)
      return true
    }
    "zIndex" -> {
      state.zIndex = value.toFloatOrNull() ?: 0f
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        // zIndex controls stacking only; do not map to native Z to avoid implicit shadows.
        view.translationZ = 0f
      }
      reorderParentChildrenByZIndex(id)
      return true
    }
    "transform" -> {
      state.transformOps = ZynthTransformParser.parse(value)
      applyTransform(this, view, state)
      return true
    }
    "transformOrigin" -> {
      state.transformOrigin = parseTransformOrigin(value)
      styleDirtyNodes.add(id)
      return true
    }
    "overflow" -> {
      val clip = value == "hidden" || value == "scroll"
      if (view is ZynthLayoutView) {
        view.setOverflowHidden(clip)
      } else {
        view.clipToOutline = clip
        if (view is android.view.ViewGroup) {
          view.clipToPadding = clip
          view.clipChildren = clip
        }
      }
      return true
    }
  }

  if (view is TextView) {
    if (isTextNode) {
      when (name) {
        "lineHeight",
        "lineSpacing",
        "paragraphSpacing",
        "baselineShift",
        "letterSpacing",
        "minimumFontScale",
        "textDecorationLine",
        "textTransform",
        "hyphenation",
        "fontSize" -> {
          return true
        }
      }
    }
    val textState = textStyleStates.getOrPut(id) { ZynthTextStyleState() }
    when (name) {
      "lineHeight" -> {
        textState.lineHeight = value.toFloatOrNull()?.let { dpToPx(it) }
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "lineSpacing" -> {
        textState.lineSpacing = value.toFloatOrNull()?.let { dpToPx(it) }
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "paragraphSpacing" -> {
        textState.paragraphSpacing = value.toFloatOrNull()?.let { dpToPx(it) }
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "baselineShift" -> {
        textState.baselineShift = value.toFloatOrNull()?.let { dpToPx(it) }
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "letterSpacing" -> {
        textState.letterSpacing = value.toFloatOrNull()?.let { dpToPx(it) }
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "minimumFontScale" -> {
        textState.minimumFontScale = value.toFloatOrNull()
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "textDecorationLine" -> {
        textState.textDecorationLine = value
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "textTransform" -> {
        textState.textTransform = value
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
      "hyphenation" -> {
        textState.hyphenation = value
        textState.applyTo(view)
        markSurfaceDirtyForNode(id)
        return true
      }
    }
  }

  return false
}

internal fun ZynthUIManager.applyStyleLayoutIfNeeded() {
  if (styleDirtyNodes.isEmpty() && styleLayoutDirtyNodes.isEmpty()) return
  val dirty = HashSet<Int>(styleDirtyNodes.size + styleLayoutDirtyNodes.size).apply {
    addAll(styleDirtyNodes)
    addAll(styleLayoutDirtyNodes)
  }
  styleDirtyNodes.clear()
  styleLayoutDirtyNodes.clear()
  for (id in dirty) {
    val view = nodes[id] ?: continue
    val state = styleStates[id] ?: continue
    applyTransformOrigin(this, view, state)
    view.invalidate()
    styleLayoutFrames[id] = android.graphics.Rect(view.left, view.top, view.right, view.bottom)
  }
}

internal fun ZynthUIManager.applyTextValue(id: Int, textView: TextView, text: String) {
  val state = textStyleStates[id]
  if (state == null) {
    textView.text = text
    return
  }
  state.rawText = text
  state.applyTo(textView)
}

private fun ZynthUIManager.ensureBorderDrawable(id: Int, view: View): ZynthBorderDrawable {
  val state = styleStates.getOrPut(id) { ZynthViewStyleState() }
  val drawable = state.borderDrawable ?: ZynthBorderDrawable().also {
    state.borderDrawable = it
  }
  drawable.renderBorderOnTop = view is ZynthLayoutView
  if (view.background !== drawable) {
    view.background = drawable
  }
  return drawable
}

private fun applyShadow(manager: ZynthUIManager, view: View, state: ZynthViewStyleState) {
  val shadow = state.shadowLayers?.firstOrNull()?.let { manager.scaleShadow(it) }
    ?: ZynthShadowParser.fromReactNative(
      state.shadowColor,
      state.shadowOpacity,
      state.shadowRadius,
      state.shadowOffsetX,
      state.shadowOffsetY
    )?.firstOrNull()
  if (shadow == null) {
    view.elevation = 0f
    return
  }
  val boosted = manager.boostShadow(shadow)
  view.elevation = boosted.blurRadius
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    view.outlineAmbientShadowColor = boosted.color
    view.outlineSpotShadowColor = boosted.color
  }
  if (view is TextView) {
    view.setShadowLayer(boosted.blurRadius, boosted.offsetX, boosted.offsetY, boosted.color)
  }
}

private fun applyTransform(manager: ZynthUIManager, view: View, state: ZynthViewStyleState) {
  val ops = state.transformOps ?: run {
    view.translationX = 0f
    view.translationY = 0f
    view.scaleX = 1f
    view.scaleY = 1f
    view.rotation = 0f
    view.rotationX = 0f
    view.rotationY = 0f
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      view.animationMatrix = null
    }
    view.setLayerType(View.LAYER_TYPE_NONE, null)
    return
  }
  var tx = 0f
  var ty = 0f
  var sx = 1f
  var sy = 1f
  var rz = 0f
  var rx = 0f
  var ry = 0f
  var skewX = 0f
  var skewY = 0f
  var hasSkew = false
  var hasPerspective = false
  var perspectiveValue = Float.NaN
  for (op in ops) {
    when (op) {
      is TransformOperation.Translate -> {
        tx += manager.dpToPx(op.x)
        ty += manager.dpToPx(op.y)
      }
      is TransformOperation.Scale -> {
        sx *= op.x
        sy *= op.y
      }
      is TransformOperation.Rotate -> rz += op.degrees
      is TransformOperation.RotateZ -> rz += op.degrees
      is TransformOperation.RotateX -> rx += op.degrees
      is TransformOperation.RotateY -> ry += op.degrees
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
  view.translationX = tx
  view.translationY = ty
  view.scaleX = sx
  view.scaleY = sy
  view.rotation = rz
  view.rotationX = rx
  view.rotationY = ry
  val has3dRotation = kotlin.math.abs(rx) > 0.001f || kotlin.math.abs(ry) > 0.001f
  val viewDensity = view.resources.displayMetrics.density.takeIf { it > 0f } ?: manager.density
  if (hasPerspective) {
    view.cameraDistance = perspectiveValue * viewDensity
  } else if (has3dRotation) {
    view.cameraDistance = DEFAULT_PERSPECTIVE * viewDensity
  }
  if (hasSkew) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val radX = Math.toRadians(skewX.toDouble()).toFloat()
      val radY = Math.toRadians(skewY.toDouble()).toFloat()
      val px = view.pivotX
      val py = view.pivotY
      val matrix = Matrix()
      matrix.setTranslate(-px, -py)
      val skew = Matrix()
      skew.setValues(
        floatArrayOf(
          1f,
          Math.tan(radX.toDouble()).toFloat(),
          0f,
          Math.tan(radY.toDouble()).toFloat(),
          1f,
          0f,
          0f,
          0f,
          1f,
        )
      )
      matrix.postConcat(skew)
      matrix.postTranslate(px, py)
      view.setLayerType(View.LAYER_TYPE_HARDWARE, null)
      view.animationMatrix = matrix
    }
  } else {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      view.animationMatrix = null
    }
    view.setLayerType(View.LAYER_TYPE_NONE, null)
  }
}

private const val DEFAULT_PERSPECTIVE = 2000f

private fun parseTransformOrigin(value: String): Pair<OriginValue, OriginValue> {
  val tokens = value.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
  val xToken = tokens.getOrNull(0) ?: "50%"
  val yToken = tokens.getOrNull(1) ?: "50%"
  return parseOriginValue(xToken) to parseOriginValue(yToken)
}

private fun parseOriginValue(token: String): OriginValue {
  val lower = token.lowercase()
  return when (lower) {
    "left", "top" -> OriginValue(0f, true)
    "center" -> OriginValue(0.5f, true)
    "right", "bottom" -> OriginValue(1f, true)
    else -> if (lower.endsWith("%")) {
      OriginValue(lower.removeSuffix("%").toFloatOrNull()?.div(100f)?.coerceIn(0f, 1f) ?: 0.5f, true)
    } else {
      OriginValue(lower.toFloatOrNull() ?: 0f, false)
    }
  }
}

private fun applyTransformOrigin(manager: ZynthUIManager, view: View, state: ZynthViewStyleState) {
  val origin = state.transformOrigin ?: return
  val width = view.width.takeIf { it > 0 } ?: return
  val height = view.height.takeIf { it > 0 } ?: return
  val x = if (origin.first.isPercent) origin.first.value * width else manager.dpToPx(origin.first.value)
  val y = if (origin.second.isPercent) origin.second.value * height else manager.dpToPx(origin.second.value)
  view.pivotX = x
  view.pivotY = y
}

private fun ZynthUIManager.scaleShadow(shadow: ShadowLayer): ShadowLayer {
  return shadow.copy(
    offsetX = dpToPx(shadow.offsetX),
    offsetY = dpToPx(shadow.offsetY),
    blurRadius = dpToPx(shadow.blurRadius),
    spread = dpToPx(shadow.spread),
  )
}

private fun ZynthUIManager.boostShadow(shadow: ShadowLayer): ShadowLayer {
  val alpha = (shadow.color ushr 24) and 0xFF
  val boostedAlpha = (alpha * 12.0f).toInt().coerceIn(0, 255)
  val color = (boostedAlpha shl 24) or (shadow.color and 0x00FFFFFF)
  return shadow.copy(
    blurRadius = shadow.blurRadius * 2.5f,
    offsetX = shadow.offsetX * 1.6f,
    offsetY = shadow.offsetY * 1.6f,
    color = color
  )
}

private fun ZynthUIManager.reorderParentChildrenByZIndex(nodeId: Int) {
  val parentId = parents[nodeId] ?: return
  val siblings = children[parentId] ?: return
  if (siblings.size <= 1) return

  val parent = nodes[nodeId]?.parent as? android.view.ViewGroup ?: return
  val ordered = siblings.mapIndexedNotNull { insertionIndex, siblingId ->
    val sibling = nodes[siblingId] ?: return@mapIndexedNotNull null
    if (sibling.parent !== parent) return@mapIndexedNotNull null
    val zIndex = styleStates[siblingId]?.zIndex ?: 0f
    Triple(sibling, zIndex, insertionIndex)
  }.sortedWith(compareBy<Triple<android.view.View, Float, Int>>({ it.second }, { it.third }))

  ordered.forEach { (child, _, _) ->
    child.bringToFront()
  }
  parent.invalidate()
}
