package com.rune.kit.layout

import android.util.Log
import com.facebook.yoga.YogaAlign
import com.facebook.yoga.YogaConfig
import com.facebook.yoga.YogaConfigFactory
import com.facebook.yoga.YogaEdge
import com.facebook.yoga.YogaFlexDirection
import com.facebook.yoga.YogaGutter
import com.facebook.yoga.YogaJustify
import com.facebook.yoga.YogaConstants
import com.facebook.yoga.YogaMeasureMode
import com.facebook.yoga.YogaMeasureOutput
import com.facebook.yoga.YogaNode
import com.facebook.yoga.YogaNodeFactory
import com.facebook.yoga.YogaWrap
import com.facebook.yoga.YogaOverflow
import kotlin.math.roundToInt

class YogaLayoutEngine(private val rootId: Int = 0) : LayoutEngine {
  private val config: YogaConfig = YogaConfigFactory.create()
  private val nodes = HashMap<Int, YogaNode>()
  private val styles = HashMap<Int, Style>()
  private val measureHandlers = HashMap<Int, MeasureHandler>()

  init {
    val rootNode = YogaNodeFactory.create(config)
    rootNode.setFlexDirection(YogaFlexDirection.COLUMN)
    // Ensure children of the root stretch to full width by default
    rootNode.setAlignItems(YogaAlign.STRETCH)
    nodes[rootId] = rootNode
  }

  private fun getNode(id: Int): YogaNode {
    return nodes[id] ?: YogaNodeFactory.create(config).also { node ->
      nodes[id] = node
      styles[id]?.let { applyStyle(node, it) }
      measureHandlers[id]?.let { handler -> attachMeasureFunc(id, node, handler) }
    }
  }

  override fun createNode(id: Int) {
    if (nodes.containsKey(id)) return
    val node = YogaNodeFactory.create(config)
    nodes[id] = node
    styles[id]?.let { applyStyle(node, it) }
    measureHandlers[id]?.let { handler -> attachMeasureFunc(id, node, handler) }
  }

  override fun removeNode(id: Int) {
    val node = nodes.remove(id) ?: return
    node.owner?.let { parent ->
      val idx = parent.indexOf(node)
      if (idx >= 0) parent.removeChildAt(idx)
    }
    node.setMeasureFunction(null)
    measureHandlers.remove(id)
    styles.remove(id)
  }

  override fun insertChild(parent: Int, child: Int, index: Int) {
    val parentNode = getNode(parent)
    val childNode = getNode(child)
    var targetIndex = index.coerceIn(0, parentNode.childCount)
    
    @Suppress("DEPRECATION")
    if (childNode.parent == parentNode) {
      val currentIndex = parentNode.indexOf(childNode)
      if (currentIndex == targetIndex) return
      parentNode.removeChildAt(currentIndex)
      if (currentIndex < targetIndex) {
        targetIndex = (targetIndex - 1).coerceAtLeast(0)
      }
    }
    childNode.owner?.let { owner ->
      val idx = owner.indexOf(childNode)
      if (idx >= 0) owner.removeChildAt(idx)
    }
    if (targetIndex > parentNode.childCount) {
      targetIndex = parentNode.childCount
    }
    parentNode.addChildAt(childNode, targetIndex)
  }

  override fun setStyle(id: Int, style: Style) {
    val merged = mergeStyles(styles[id], style)
    styles[id] = merged
    val node = getNode(id)
    applyStyle(node, merged)
  }

  override fun calculateLayout(width: Int, height: Int) {
    val rootNode = getNode(rootId)
    rootNode.calculateLayout(width.toFloat(), height.toFloat())
  }

  override fun calculateLayoutForNode(nodeId: Int, width: Float, height: Float) {
    val node = nodes[nodeId]
    if (node == null) {
      android.util.Log.w("YogaLayoutEngine", "calculateLayoutForNode: Node $nodeId not found!")
      return
    }
    val resolvedWidth = if (width.isNaN()) YogaConstants.UNDEFINED else width
    val resolvedHeight = if (height.isNaN()) YogaConstants.UNDEFINED else height
    node.calculateLayout(resolvedWidth, resolvedHeight)
  }

  override fun frame(id: Int): Rect {
    val node = nodes[id] ?: return Rect(0, 0, 0, 0)
    val left = node.layoutX.roundToInt()
    val top = node.layoutY.roundToInt()
    val right = (node.layoutX + node.layoutWidth).roundToInt()
    val bottom = (node.layoutY + node.layoutHeight).roundToInt()
    return Rect(left, top, right, bottom)
  }

  override fun getAllFrames(): Map<Int, Rect> {
    val frameMap = HashMap<Int, Rect>(nodes.size)
    for ((id, node) in nodes) {
      val left = node.layoutX.roundToInt()
      val top = node.layoutY.roundToInt()
      val right = (node.layoutX + node.layoutWidth).roundToInt()
      val bottom = (node.layoutY + node.layoutHeight).roundToInt()
      frameMap[id] = Rect(left, top, right, bottom)
    }
    return frameMap
  }

  override fun setMeasureHandler(id: Int, handler: MeasureHandler?) {
    if (handler == null) {
      measureHandlers.remove(id)
      nodes[id]?.setMeasureFunction(null)
      return
    }
    measureHandlers[id] = handler
    val node = getNode(id)
    attachMeasureFunc(id, node, handler)
  }

  override fun markDirty(id: Int) {
    nodes[id]?.let { node ->
      // Only mark dirty if node exists AND satisfies Yoga requirements:
      // 1. It must be a leaf node (childCount == 0)
      // 2. It must have a custom measure function (we track this in measureHandlers)
      // Calling dirty() on other nodes causes a native abort.
      val hasMeasureFunc = measureHandlers.containsKey(id)
      val isLeaf = node.childCount == 0
      
      if (hasMeasureFunc && isLeaf) {
        try {
          node.dirty()
        } catch (e: Throwable) {
          Log.d("YogaEngine", "markDirty on node $id ignored: ${e.message}")
        }
      }
    }
  }

  override fun reset() {
    val rootNode = nodes[rootId] ?: YogaNodeFactory.create(config).also { node ->
      node.setFlexDirection(YogaFlexDirection.COLUMN)
      node.setAlignItems(YogaAlign.STRETCH)
      nodes[rootId] = node
    }

    val iterator = nodes.entries.iterator()
    while (iterator.hasNext()) {
      val (id, node) = iterator.next()
      if (id == rootId) continue
      clearNode(node)
      iterator.remove()
    }

    clearNode(rootNode)

    styles.clear()
    measureHandlers.clear()
  }

  private fun clearNode(node: YogaNode) {
    node.setMeasureFunction(null)
    while (node.childCount > 0) {
      node.removeChildAt(node.childCount - 1)
    }
  }

  private fun attachMeasureFunc(@Suppress("UNUSED_PARAMETER") id: Int, node: YogaNode, handler: MeasureHandler) {
    node.setMeasureFunction { _, width, widthMode, height, heightMode ->
      val input = MeasureInput(
        width,
        widthMode.toMeasureMode(),
        height,
        heightMode.toMeasureMode(),
      )
      val (measuredWidth, measuredHeight) = handler(input)
      YogaMeasureOutput.make(measuredWidth, measuredHeight)
    }
  }

  private fun applyStyle(node: YogaNode, style: Style) {
    // Width / Height: support absolute and percent
    fun clamp(value: Float?, minValue: Float?, maxValue: Float?): Float? {
      var result = value ?: return null
      minValue?.let { if (result < it) result = it }
      maxValue?.let { if (result > it) result = it }
      return result
    }

    val resolvedWidth = clamp(style.width, style.minWidth, style.maxWidth)
    val resolvedHeight = clamp(style.height, style.minHeight, style.maxHeight)

    when {
      style.widthAuto -> {
        node.setWidthAuto()
      }
      resolvedWidth != null -> {
        node.setWidth(resolvedWidth)
      }
      style.widthPercent != null -> {
        node.setWidthPercent(style.widthPercent)
      }
      else -> {
        node.setWidthAuto()
      }
    }
    when {
      style.heightAuto -> {
        node.setHeightAuto()
      }
      resolvedHeight != null -> {
        node.setHeight(resolvedHeight)
      }
      style.heightPercent != null -> {
        node.setHeightPercent(style.heightPercent)
      }
      else -> {
        node.setHeightAuto()
      }
    }
    when {
      style.minWidthPercent != null -> node.setMinWidthPercent(style.minWidthPercent)
      style.minWidth != null -> node.setMinWidth(style.minWidth)
      else -> node.setMinWidth(YogaConstants.UNDEFINED)
    }
    when {
      style.maxWidthPercent != null -> node.setMaxWidthPercent(style.maxWidthPercent)
      style.maxWidth != null -> node.setMaxWidth(style.maxWidth)
      else -> node.setMaxWidth(YogaConstants.UNDEFINED)
    }
    when {
      style.minHeightPercent != null -> node.setMinHeightPercent(style.minHeightPercent)
      style.minHeight != null -> node.setMinHeight(style.minHeight)
      else -> node.setMinHeight(YogaConstants.UNDEFINED)
    }
    when {
      style.maxHeightPercent != null -> node.setMaxHeightPercent(style.maxHeightPercent)
      style.maxHeight != null -> node.setMaxHeight(style.maxHeight)
      else -> node.setMaxHeight(YogaConstants.UNDEFINED)
    }
    style.flexGrow?.let { node.setFlexGrow(it) }
    style.flexShrink?.let { node.setFlexShrink(it) }
    when {
        style.flexBasisAuto -> node.setFlexBasisAuto()
        style.flexBasis != null -> node.setFlexBasis(style.flexBasis)
        style.flexBasisPercent != null -> node.setFlexBasisPercent(style.flexBasisPercent)
        else -> node.setFlexBasisAuto()
    }
    node.setFlex(style.flex ?: 0f)
    node.setFlexDirection(style.flexDirection?.toFlexDirection() ?: YogaFlexDirection.COLUMN)
    node.setWrap(style.flexWrap?.toWrap() ?: YogaWrap.NO_WRAP)
    node.setJustifyContent(style.justifyContent?.toJustify() ?: YogaJustify.FLEX_START)
    node.setAlignContent(style.alignContent?.toAlignContent() ?: YogaAlign.FLEX_START)
    // Default to STRETCH so children take full width of parent; allow explicit alignSelf override
    node.setAlignItems(style.alignItems?.toAlignItems() ?: YogaAlign.STRETCH)
    // Only set alignSelf if explicitly provided (matches iOS behavior)
    // Yoga's default is AUTO which inherits from parent's alignItems
    style.alignSelf?.let { alignSelf ->
      val yogaAlign = when (alignSelf.lowercase()) {
        "auto" -> YogaAlign.AUTO
        "flex-start", "flex_start" -> YogaAlign.FLEX_START
        "flex-end", "flex_end" -> YogaAlign.FLEX_END
        "center" -> YogaAlign.CENTER
        "stretch" -> YogaAlign.STRETCH
        "baseline" -> YogaAlign.BASELINE
        else -> YogaAlign.AUTO
      }
      node.setAlignSelf(yogaAlign)
    }
    style.aspectRatio?.let { node.setAspectRatio(it) }
    node.setOverflow(style.overflow?.toOverflow() ?: YogaOverflow.VISIBLE)
    applyPadding(node, style)
    applyMargin(node, style)
    applyGap(node, style)
    applyBorder(node, style)
    applyPosition(node, style)
    applyDisplay(node, style)
  }

  private fun mergeStyles(prev: Style?, next: Style): Style {
    if (prev == null) return next
    return Style(
      width = when {
        next.widthAuto -> null
        next.width != null -> next.width
        else -> prev.width
      },
      height = when {
        next.heightAuto -> null
        next.height != null -> next.height
        else -> prev.height
      },
      widthPercent = when {
        next.widthAuto -> null
        next.widthPercent != null -> next.widthPercent
        else -> prev.widthPercent
      },
      heightPercent = when {
        next.heightAuto -> null
        next.heightPercent != null -> next.heightPercent
        else -> prev.heightPercent
      },
      minWidth = when {
        next.minWidthPercent != null -> null
        next.minWidth != null -> next.minWidth
        else -> prev.minWidth
      },
      minWidthPercent = when {
        next.minWidthPercent != null -> next.minWidthPercent
        next.minWidth != null -> null
        else -> prev.minWidthPercent
      },
      maxWidth = when {
        next.maxWidthPercent != null -> null
        next.maxWidth != null -> next.maxWidth
        else -> prev.maxWidth
      },
      maxWidthPercent = when {
        next.maxWidthPercent != null -> next.maxWidthPercent
        next.maxWidth != null -> null
        else -> prev.maxWidthPercent
      },
      minHeight = when {
        next.minHeightPercent != null -> null
        next.minHeight != null -> next.minHeight
        else -> prev.minHeight
      },
      minHeightPercent = when {
        next.minHeightPercent != null -> next.minHeightPercent
        next.minHeight != null -> null
        else -> prev.minHeightPercent
      },
      maxHeight = when {
        next.maxHeightPercent != null -> null
        next.maxHeight != null -> next.maxHeight
        else -> prev.maxHeight
      },
      maxHeightPercent = when {
        next.maxHeightPercent != null -> next.maxHeightPercent
        next.maxHeight != null -> null
        else -> prev.maxHeightPercent
      },
      flex = next.flex ?: prev.flex,
      flexGrow = next.flexGrow ?: prev.flexGrow,
      flexShrink = next.flexShrink ?: prev.flexShrink,
      flexBasis = when {
        next.flexBasisAuto -> null
        next.flexBasis != null -> next.flexBasis
        else -> prev.flexBasis
      },
      flexBasisPercent = when {
        next.flexBasisAuto -> null
        next.flexBasisPercent != null -> next.flexBasisPercent
        else -> prev.flexBasisPercent
      },
      flexBasisAuto = when {
        next.flexBasisAuto -> true
        next.flexBasis != null || next.flexBasisPercent != null -> false
        else -> prev.flexBasisAuto
      },
      flexDirection = next.flexDirection ?: prev.flexDirection,
      flexWrap = next.flexWrap ?: prev.flexWrap,
      justifyContent = next.justifyContent ?: prev.justifyContent,
      alignItems = next.alignItems ?: prev.alignItems,
      alignContent = next.alignContent ?: prev.alignContent,
      alignSelf = next.alignSelf ?: prev.alignSelf,
      aspectRatio = next.aspectRatio ?: prev.aspectRatio,
      overflow = next.overflow ?: prev.overflow,
      zIndex = next.zIndex ?: prev.zIndex,
      position = next.position ?: prev.position,
      top = next.top ?: prev.top,
      right = next.right ?: prev.right,
      bottom = next.bottom ?: prev.bottom,
      left = next.left ?: prev.left,
      display = next.display ?: prev.display,
      padding = next.padding ?: prev.padding,
      paddingHorizontal = next.paddingHorizontal ?: prev.paddingHorizontal,
      paddingVertical = next.paddingVertical ?: prev.paddingVertical,
      paddingLeft = next.paddingLeft ?: prev.paddingLeft,
      paddingRight = next.paddingRight ?: prev.paddingRight,
      paddingTop = next.paddingTop ?: prev.paddingTop,
      paddingBottom = next.paddingBottom ?: prev.paddingBottom,
      margin = next.margin ?: prev.margin,
      marginLeft = next.marginLeft ?: prev.marginLeft,
      marginRight = next.marginRight ?: prev.marginRight,
      marginTop = next.marginTop ?: prev.marginTop,
      marginBottom = next.marginBottom ?: prev.marginBottom,
      gap = next.gap ?: prev.gap,
      rowGap = next.rowGap ?: prev.rowGap,
      columnGap = next.columnGap ?: prev.columnGap,
      backgroundColor = next.backgroundColor ?: prev.backgroundColor,
      borderRadius = next.borderRadius ?: prev.borderRadius,
      borderColor = next.borderColor ?: prev.borderColor,
      borderWidth = next.borderWidth ?: prev.borderWidth,
      borderStyle = next.borderStyle ?: prev.borderStyle,
      opacity = next.opacity ?: prev.opacity,
      fontSize = next.fontSize ?: prev.fontSize,
      color = next.color ?: prev.color,
      fontWeight = next.fontWeight ?: prev.fontWeight,
      widthAuto = when {
        next.widthAuto -> true
        next.width != null || next.widthPercent != null -> false
        else -> prev.widthAuto
      },
      heightAuto = when {
        next.heightAuto -> true
        next.height != null || next.heightPercent != null -> false
        else -> prev.heightAuto
      },
    )
  }

  private fun applyPadding(node: YogaNode, style: Style) {
    node.setPadding(YogaEdge.ALL, 0f)
    style.padding?.let { node.setPadding(YogaEdge.ALL, it) }
    style.paddingHorizontal?.let { node.setPadding(YogaEdge.HORIZONTAL, it) }
    style.paddingVertical?.let { node.setPadding(YogaEdge.VERTICAL, it) }
    style.paddingLeft?.let { node.setPadding(YogaEdge.LEFT, it) }
    style.paddingRight?.let { node.setPadding(YogaEdge.RIGHT, it) }
    style.paddingTop?.let { node.setPadding(YogaEdge.TOP, it) }
    style.paddingBottom?.let { node.setPadding(YogaEdge.BOTTOM, it) }
  }

  private fun applyMargin(node: YogaNode, style: Style) {
    node.setMargin(YogaEdge.ALL, 0f)
    style.margin?.let { node.setMargin(YogaEdge.ALL, it) }
    style.marginLeft?.let { node.setMargin(YogaEdge.LEFT, it) }
    style.marginRight?.let { node.setMargin(YogaEdge.RIGHT, it) }
    style.marginTop?.let { node.setMargin(YogaEdge.TOP, it) }
    style.marginBottom?.let { node.setMargin(YogaEdge.BOTTOM, it) }
  }

  private fun applyGap(node: YogaNode, style: Style) {
    node.setGap(YogaGutter.ROW, 0f)
    node.setGap(YogaGutter.COLUMN, 0f)
    style.gap?.let {
      node.setGap(YogaGutter.ROW, it)
      node.setGap(YogaGutter.COLUMN, it)
    }
    style.rowGap?.let { node.setGap(YogaGutter.ROW, it) }
    style.columnGap?.let { node.setGap(YogaGutter.COLUMN, it) }
  }

  private fun applyBorder(node: YogaNode, style: Style) {
    val width = style.borderWidth ?: 0f
    node.setBorder(YogaEdge.ALL, width)
  }

  private fun applyPosition(node: YogaNode, style: Style) {
    // Set position type
    style.position?.let { positionType ->
      when (positionType.lowercase()) {
        "absolute" -> node.setPositionType(com.facebook.yoga.YogaPositionType.ABSOLUTE)
        "relative" -> node.setPositionType(com.facebook.yoga.YogaPositionType.RELATIVE)
        else -> node.setPositionType(com.facebook.yoga.YogaPositionType.RELATIVE)
      }
    }
    
    // Set position edges
    style.top?.let { node.setPosition(YogaEdge.TOP, it) }
    style.right?.let { node.setPosition(YogaEdge.RIGHT, it) }
    style.bottom?.let { node.setPosition(YogaEdge.BOTTOM, it) }
    style.left?.let { node.setPosition(YogaEdge.LEFT, it) }
  }

  private fun applyDisplay(node: YogaNode, style: Style) {
    style.display?.let { displayValue ->
      when (displayValue.lowercase()) {
        "none" -> node.setDisplay(com.facebook.yoga.YogaDisplay.NONE)
        "flex" -> node.setDisplay(com.facebook.yoga.YogaDisplay.FLEX)
        else -> node.setDisplay(com.facebook.yoga.YogaDisplay.FLEX)
      }
    }
  }

  @Suppress("EXTENSION_SHADOWED_BY_MEMBER")
  private fun YogaNode.indexOf(child: YogaNode): Int {
    for (i in 0 until childCount) {
      if (getChildAt(i) === child) return i
    }
    return -1
  }

  private fun YogaMeasureMode.toMeasureMode(): MeasureMode = when (this) {
    YogaMeasureMode.UNDEFINED -> MeasureMode.UNDEFINED
    YogaMeasureMode.EXACTLY -> MeasureMode.EXACTLY
    YogaMeasureMode.AT_MOST -> MeasureMode.AT_MOST
  }

  private fun String.toFlexDirection(): YogaFlexDirection = when (trim().lowercase()) {
    "row" -> YogaFlexDirection.ROW
    "row-reverse", "row_reverse" -> YogaFlexDirection.ROW_REVERSE
    "column" -> YogaFlexDirection.COLUMN
    "column-reverse", "column_reverse" -> YogaFlexDirection.COLUMN_REVERSE
    else -> YogaFlexDirection.COLUMN
  }

  private fun String.toJustify(): YogaJustify = when (trim().lowercase()) {
    "center" -> YogaJustify.CENTER
    "flex-end" -> YogaJustify.FLEX_END
    "space-between" -> YogaJustify.SPACE_BETWEEN
    "space-around" -> YogaJustify.SPACE_AROUND
    "space-evenly" -> YogaJustify.SPACE_EVENLY
    else -> YogaJustify.FLEX_START
  }

  private fun String.toAlignItems(): YogaAlign = when (trim().lowercase().replace("-", "_")) {
    "center" -> YogaAlign.CENTER
    "flex_end", "flexend", "end" -> YogaAlign.FLEX_END
    "flex_start", "flexstart", "start" -> YogaAlign.FLEX_START
    "stretch" -> YogaAlign.STRETCH
    "baseline" -> YogaAlign.BASELINE
    else -> YogaAlign.STRETCH
  }

  private fun String.toWrap(): YogaWrap = when (trim().lowercase()) {
    "wrap" -> YogaWrap.WRAP
    "wrap-reverse" -> YogaWrap.WRAP_REVERSE
    "nowrap" -> YogaWrap.NO_WRAP
    else -> YogaWrap.NO_WRAP
  }

  private fun String.toAlignContent(): YogaAlign = when (trim().lowercase().replace("-", "_")) {
    "flex_start", "flexstart" -> YogaAlign.FLEX_START
    "flex_end", "flexend" -> YogaAlign.FLEX_END
    "center" -> YogaAlign.CENTER
    "stretch" -> YogaAlign.STRETCH
    "space_between", "spacebetween" -> YogaAlign.SPACE_BETWEEN
    "space_around", "spacearound" -> YogaAlign.SPACE_AROUND
    else -> YogaAlign.FLEX_START
  }

  private fun String.toOverflow(): YogaOverflow = when (trim().lowercase()) {
    "hidden" -> YogaOverflow.HIDDEN
    "scroll" -> YogaOverflow.SCROLL
    "visible" -> YogaOverflow.VISIBLE
    else -> YogaOverflow.VISIBLE
  }
}
