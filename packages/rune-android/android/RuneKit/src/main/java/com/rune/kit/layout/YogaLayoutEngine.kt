package com.rune.kit.layout

import com.facebook.yoga.YogaAlign
import com.facebook.yoga.YogaConfig
import com.facebook.yoga.YogaConfigFactory
import com.facebook.yoga.YogaEdge
import com.facebook.yoga.YogaFlexDirection
import com.facebook.yoga.YogaGutter
import com.facebook.yoga.YogaJustify
import com.facebook.yoga.YogaMeasureMode
import com.facebook.yoga.YogaMeasureOutput
import com.facebook.yoga.YogaNode
import com.facebook.yoga.YogaNodeFactory
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
    val targetIndex = index.coerceIn(0, parentNode.childCount)
    if (childNode.parent == parentNode) {
      val currentIndex = parentNode.indexOf(childNode)
      if (currentIndex == targetIndex) return
      parentNode.removeChildAt(currentIndex)
    }
    childNode.owner?.let { owner ->
      val idx = owner.indexOf(childNode)
      if (idx >= 0) owner.removeChildAt(idx)
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
      // Only mark dirty if a measure function is defined or the node exists
      // Yoga will re-run measurement on next calculateLayout
      try {
        node.dirty()
      } catch (_: Throwable) {
        // Some Yoga versions throw if no measure function is set; ignore safely
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

  private fun attachMeasureFunc(id: Int, node: YogaNode, handler: MeasureHandler) {
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
      style.widthAuto -> node.setWidthAuto()
      resolvedWidth != null -> node.setWidth(resolvedWidth)
      style.widthPercent != null -> node.setWidthPercent(style.widthPercent)
      else -> node.setWidthAuto()
    }
    when {
      style.heightAuto -> node.setHeightAuto()
      resolvedHeight != null -> node.setHeight(resolvedHeight)
      style.heightPercent != null -> node.setHeightPercent(style.heightPercent)
      else -> node.setHeightAuto()
    }
    style.minWidth?.let { node.setMinWidth(it) }
    style.maxWidth?.let { node.setMaxWidth(it) }
    style.minHeight?.let { node.setMinHeight(it) }
    style.maxHeight?.let { node.setMaxHeight(it) }
    style.flexGrow?.let { node.setFlexGrow(it) }
    style.flexShrink?.let { node.setFlexShrink(it) }
    node.setFlex(style.flex ?: 0f)
    node.setFlexDirection(style.flexDirection?.toFlexDirection() ?: YogaFlexDirection.COLUMN)
    node.setJustifyContent(style.justifyContent?.toJustify() ?: YogaJustify.FLEX_START)
    // Default to STRETCH so children take full width of parent; allow explicit alignSelf override
    node.setAlignItems(style.alignItems?.toAlignItems() ?: YogaAlign.STRETCH)
    style.alignSelf?.let { alignSelf ->
      val yogaAlign = when (alignSelf.lowercase()) {
        "auto" -> null
        "flex-start", "flex_start" -> YogaAlign.FLEX_START
        "flex-end", "flex_end" -> YogaAlign.FLEX_END
        "center" -> YogaAlign.CENTER
        "stretch" -> YogaAlign.STRETCH
        "baseline" -> YogaAlign.BASELINE
        else -> null
      }
      if (yogaAlign != null) node.setAlignSelf(yogaAlign) else node.setAlignSelf(YogaAlign.AUTO)
    }
    applyPadding(node, style)
    applyMargin(node, style)
    applyGap(node, style)
    applyBorder(node, style)
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
      minWidth = next.minWidth ?: prev.minWidth,
      maxWidth = next.maxWidth ?: prev.maxWidth,
      minHeight = next.minHeight ?: prev.minHeight,
      maxHeight = next.maxHeight ?: prev.maxHeight,
      flex = next.flex ?: prev.flex,
      flexGrow = next.flexGrow ?: prev.flexGrow,
      flexShrink = next.flexShrink ?: prev.flexShrink,
      flexDirection = next.flexDirection ?: prev.flexDirection,
      justifyContent = next.justifyContent ?: prev.justifyContent,
      alignItems = next.alignItems ?: prev.alignItems,
      alignSelf = next.alignSelf ?: prev.alignSelf,
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

  private fun String.toFlexDirection(): YogaFlexDirection = when (lowercase()) {
    "row", "row-reverse" -> YogaFlexDirection.ROW
    "column", "column-reverse" -> YogaFlexDirection.COLUMN
    else -> YogaFlexDirection.COLUMN
  }

  private fun String.toJustify(): YogaJustify = when (lowercase()) {
    "center" -> YogaJustify.CENTER
    "flex-end" -> YogaJustify.FLEX_END
    "space-between" -> YogaJustify.SPACE_BETWEEN
    "space-around" -> YogaJustify.SPACE_AROUND
    "space-evenly" -> YogaJustify.SPACE_EVENLY
    else -> YogaJustify.FLEX_START
  }

  private fun String.toAlignItems(): YogaAlign = when (lowercase()) {
    "center" -> YogaAlign.CENTER
    "flex-end" -> YogaAlign.FLEX_END
    "stretch" -> YogaAlign.STRETCH
    "baseline" -> YogaAlign.BASELINE
    else -> YogaAlign.STRETCH
  }
}
