package com.rune.kit.layout

import com.facebook.yoga.YogaAlign
import com.facebook.yoga.YogaConfig
import com.facebook.yoga.YogaConfigFactory
import com.facebook.yoga.YogaEdge
import com.facebook.yoga.YogaFlexDirection
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
    styles[id] = style
    val node = getNode(id)
    applyStyle(node, style)
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
    if (style.width != null) node.setWidth(style.width) else node.setWidthAuto()
    if (style.height != null) node.setHeight(style.height) else node.setHeightAuto()
    node.setFlex(style.flex ?: 0f)
    node.setFlexDirection(style.flexDirection?.toFlexDirection() ?: YogaFlexDirection.COLUMN)
    node.setJustifyContent(style.justifyContent?.toJustify() ?: YogaJustify.FLEX_START)
    // Default to STRETCH so children take full width of parent
    node.setAlignItems(style.alignItems?.toAlignItems() ?: YogaAlign.STRETCH)
    applyPadding(node, style)
    applyMargin(node, style)
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
    else -> YogaAlign.FLEX_START
  }
}
