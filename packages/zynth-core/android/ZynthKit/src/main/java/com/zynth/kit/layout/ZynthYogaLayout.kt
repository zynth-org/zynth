package com.zynth.kit.layout

import android.view.View
import android.widget.TextView
import com.zynth.kit.core.ZynthLayoutView
import com.facebook.yoga.YogaConfig
import com.facebook.yoga.YogaConfigFactory
import com.facebook.yoga.YogaDisplay
import com.facebook.yoga.YogaEdge
import com.facebook.yoga.YogaFlexDirection
import com.facebook.yoga.YogaGutter
import com.facebook.yoga.YogaJustify
import com.facebook.yoga.YogaMeasureFunction
import com.facebook.yoga.YogaMeasureMode
import com.facebook.yoga.YogaMeasureOutput
import com.facebook.yoga.YogaNode
import com.facebook.yoga.YogaNodeFactory
import com.facebook.yoga.YogaOverflow
import com.facebook.yoga.YogaPositionType
import com.facebook.yoga.YogaWrap
import com.facebook.yoga.YogaAlign

class ZynthYogaLayout {
  private val config: YogaConfig = YogaConfigFactory.create().apply {
    setUseWebDefaults(false)
  }
  private val nodes = HashMap<Int, YogaNode>()
  private val nodeIds = ArrayList<Int>()
  private val measureHandlers = HashMap<Int, MeasureHandler>()
  private var measureCount = 0
  private var lastMeasureCount = 0
  private var lastChangedCount = 0
  private var pendingApplyIds: List<Int>? = null
  private var pendingApplyIndex = 0
  private var pendingApplyRootWidth = 0
  private var pendingApplyRootHeight = 0
  private var pendingApplyDirty = false
  private val rootNode: YogaNode = YogaNodeFactory.create(config).apply {
    flexDirection = YogaFlexDirection.COLUMN
    alignItems = YogaAlign.STRETCH
  }
  var layoutDidUpdate: ((id: Int, left: Int, top: Int, right: Int, bottom: Int, changed: Boolean) -> Unit)? = null

  fun ensureNode(id: Int, view: View) {
    if (nodes.containsKey(id)) return
    pendingApplyDirty = true
    val node = YogaNodeFactory.create(config)
    node.data = view
    val handler = measureHandlers[id]
    if (handler != null) {
      attachMeasureHandler(node, handler)
    } else if (view is TextView) {
      node.setMeasureFunction(createTextMeasure(view))
    }
    nodes[id] = node
    nodeIds.add(id)
  }

  fun ensureRootChild(id: Int) {
    val node = nodes[id] ?: return
    if (node.owner == null) {
      pendingApplyDirty = true
      rootNode.addChildAt(node, rootNode.childCount)
    }
  }

  fun removeNode(id: Int) {
    measureHandlers.remove(id)
    val node = nodes.remove(id) ?: return
    nodeIds.remove(id as Any?)
    pendingApplyDirty = true
    if (node.childCount > 0) {
      for (i in node.childCount - 1 downTo 0) {
        node.removeChildAt(i)
      }
    }
    node.owner?.removeChildAt(node.owner?.indexOf(node) ?: 0)
    node.data = null
    node.reset()
  }

  fun insertChild(parentId: Int, childId: Int, index: Int) {
    val child = nodes[childId] ?: return
    val parent = if (parentId == 0) rootNode else nodes[parentId]
    if (parent == null) return
    if (parent.isMeasureDefined) return
    pendingApplyDirty = true
    if (child.owner != null) {
      child.owner?.removeChildAt(child.owner?.indexOf(child) ?: 0)
    }
    val targetIndex = index.coerceIn(0, parent.childCount)
    parent.addChildAt(child, targetIndex)
  }

  fun removeChild(parentId: Int, childId: Int) {
    val child = nodes[childId] ?: return
    val parent = if (parentId == 0) rootNode else nodes[parentId]
    if (parent == null) return
    val idx = parent.indexOf(child)
    if (idx >= 0) {
      pendingApplyDirty = true
      parent.removeChildAt(idx)
    }
  }

  fun markDirty(id: Int) {
    val node = nodes[id] ?: return
    val hasMeasure = measureHandlers.containsKey(id) || node.isMeasureDefined
    if (!hasMeasure) return
    if (node.childCount != 0) return
    if (node.owner == null) return
    pendingApplyDirty = true
    try {
      node.dirty()
    } catch (_: Throwable) {
      // Ignore Yoga exceptions for safety.
    }
  }

  fun setMeasureHandler(id: Int, handler: MeasureHandler?) {
    val node = nodes[id] ?: return
    pendingApplyDirty = true
    if (handler == null) {
      measureHandlers.remove(id)
      if (!node.isMeasureDefined) return
      node.setMeasureFunction(null)
      return
    }
    measureHandlers[id] = handler
    attachMeasureHandler(node, handler)
  }

  fun setStyle(id: Int, name: String, value: Float) {
    val node = nodes[id] ?: return
    pendingApplyDirty = true
    when (name) {
      "width" -> node.setWidth(value)
      "height" -> node.setHeight(value)
      "minWidth" -> node.setMinWidth(value)
      "minHeight" -> node.setMinHeight(value)
      "maxWidth" -> node.setMaxWidth(value)
      "maxHeight" -> node.setMaxHeight(value)
      "flex" -> node.flex = value
      "flexGrow" -> node.flexGrow = value
      "flexShrink" -> node.flexShrink = value
      "flexBasis" -> node.setFlexBasis(value)
      "top" -> node.setPosition(YogaEdge.TOP, value)
      "right" -> node.setPosition(YogaEdge.RIGHT, value)
      "bottom" -> node.setPosition(YogaEdge.BOTTOM, value)
      "left" -> node.setPosition(YogaEdge.LEFT, value)
      "padding" -> node.setPadding(YogaEdge.ALL, value)
      "paddingHorizontal" -> {
        node.setPadding(YogaEdge.LEFT, value)
        node.setPadding(YogaEdge.RIGHT, value)
      }
      "paddingVertical" -> {
        node.setPadding(YogaEdge.TOP, value)
        node.setPadding(YogaEdge.BOTTOM, value)
      }
      "paddingTop" -> node.setPadding(YogaEdge.TOP, value)
      "paddingRight" -> node.setPadding(YogaEdge.RIGHT, value)
      "paddingBottom" -> node.setPadding(YogaEdge.BOTTOM, value)
      "paddingLeft" -> node.setPadding(YogaEdge.LEFT, value)
      "margin" -> node.setMargin(YogaEdge.ALL, value)
      "marginHorizontal" -> {
        node.setMargin(YogaEdge.LEFT, value)
        node.setMargin(YogaEdge.RIGHT, value)
      }
      "marginVertical" -> {
        node.setMargin(YogaEdge.TOP, value)
        node.setMargin(YogaEdge.BOTTOM, value)
      }
      "marginTop" -> node.setMargin(YogaEdge.TOP, value)
      "marginRight" -> node.setMargin(YogaEdge.RIGHT, value)
      "marginBottom" -> node.setMargin(YogaEdge.BOTTOM, value)
      "marginLeft" -> node.setMargin(YogaEdge.LEFT, value)
      "gap" -> node.setGap(YogaGutter.ALL, value)
      "rowGap" -> node.setGap(YogaGutter.ROW, value)
      "columnGap" -> node.setGap(YogaGutter.COLUMN, value)
      "aspectRatio" -> node.aspectRatio = value
    }
  }

  fun setStyle(id: Int, name: String, value: String?) {
    val node = nodes[id] ?: return
    pendingApplyDirty = true
    when (name) {
      "width" -> applyDimension(value, node::setWidth, node::setWidthPercent, node::setWidthAuto)
      "height" -> applyDimension(value, node::setHeight, node::setHeightPercent, node::setHeightAuto)
      "minWidth" -> applyDimension(value, node::setMinWidth, node::setMinWidthPercent, null)
      "minHeight" -> applyDimension(value, node::setMinHeight, node::setMinHeightPercent, null)
      "maxWidth" -> applyDimension(value, node::setMaxWidth, node::setMaxWidthPercent, null)
      "maxHeight" -> applyDimension(value, node::setMaxHeight, node::setMaxHeightPercent, null)
      "flex" -> value?.toFloatOrNull()?.let { node.flex = it }
      "flexGrow" -> value?.toFloatOrNull()?.let { node.flexGrow = it }
      "flexShrink" -> value?.toFloatOrNull()?.let { node.flexShrink = it }
      "flexBasis" -> applyDimension(value, node::setFlexBasis, node::setFlexBasisPercent, node::setFlexBasisAuto)
      "flexDirection" -> node.flexDirection = when (value) {
        "row" -> YogaFlexDirection.ROW
        "column-reverse" -> YogaFlexDirection.COLUMN_REVERSE
        "row-reverse" -> YogaFlexDirection.ROW_REVERSE
        else -> YogaFlexDirection.COLUMN
      }
      "flexWrap" -> node.wrap = when (value) {
        "wrap" -> YogaWrap.WRAP
        "wrap-reverse" -> YogaWrap.WRAP_REVERSE
        else -> YogaWrap.NO_WRAP
      }
      "justifyContent" -> node.justifyContent = when (value) {
        "flex-end" -> YogaJustify.FLEX_END
        "center" -> YogaJustify.CENTER
        "space-between" -> YogaJustify.SPACE_BETWEEN
        "space-around" -> YogaJustify.SPACE_AROUND
        "space-evenly" -> YogaJustify.SPACE_EVENLY
        else -> YogaJustify.FLEX_START
      }
      "alignItems" -> node.alignItems = parseAlign(value)
      "alignSelf" -> node.alignSelf = parseAlign(value)
      "alignContent" -> node.alignContent = parseAlign(value)
      "position" -> node.positionType = when (value) {
        "absolute" -> YogaPositionType.ABSOLUTE
        else -> YogaPositionType.RELATIVE
      }
      "top" -> value?.toFloatOrNull()?.let { node.setPosition(YogaEdge.TOP, it) }
      "right" -> value?.toFloatOrNull()?.let { node.setPosition(YogaEdge.RIGHT, it) }
      "bottom" -> value?.toFloatOrNull()?.let { node.setPosition(YogaEdge.BOTTOM, it) }
      "left" -> value?.toFloatOrNull()?.let { node.setPosition(YogaEdge.LEFT, it) }
      "padding" -> value?.toFloatOrNull()?.let { node.setPadding(YogaEdge.ALL, it) }
      "paddingHorizontal" -> value?.toFloatOrNull()?.let {
        node.setPadding(YogaEdge.LEFT, it)
        node.setPadding(YogaEdge.RIGHT, it)
      }
      "paddingVertical" -> value?.toFloatOrNull()?.let {
        node.setPadding(YogaEdge.TOP, it)
        node.setPadding(YogaEdge.BOTTOM, it)
      }
      "paddingTop" -> value?.toFloatOrNull()?.let { node.setPadding(YogaEdge.TOP, it) }
      "paddingRight" -> value?.toFloatOrNull()?.let { node.setPadding(YogaEdge.RIGHT, it) }
      "paddingBottom" -> value?.toFloatOrNull()?.let { node.setPadding(YogaEdge.BOTTOM, it) }
      "paddingLeft" -> value?.toFloatOrNull()?.let { node.setPadding(YogaEdge.LEFT, it) }
      "margin" -> value?.toFloatOrNull()?.let { node.setMargin(YogaEdge.ALL, it) }
      "marginHorizontal" -> value?.toFloatOrNull()?.let {
        node.setMargin(YogaEdge.LEFT, it)
        node.setMargin(YogaEdge.RIGHT, it)
      }
      "marginVertical" -> value?.toFloatOrNull()?.let {
        node.setMargin(YogaEdge.TOP, it)
        node.setMargin(YogaEdge.BOTTOM, it)
      }
      "marginTop" -> value?.toFloatOrNull()?.let { node.setMargin(YogaEdge.TOP, it) }
      "marginRight" -> value?.toFloatOrNull()?.let { node.setMargin(YogaEdge.RIGHT, it) }
      "marginBottom" -> value?.toFloatOrNull()?.let { node.setMargin(YogaEdge.BOTTOM, it) }
      "marginLeft" -> value?.toFloatOrNull()?.let { node.setMargin(YogaEdge.LEFT, it) }
      "gap" -> value?.toFloatOrNull()?.let { node.setGap(com.facebook.yoga.YogaGutter.ALL, it) }
      "rowGap" -> value?.toFloatOrNull()?.let { node.setGap(com.facebook.yoga.YogaGutter.ROW, it) }
      "columnGap" -> value?.toFloatOrNull()?.let { node.setGap(com.facebook.yoga.YogaGutter.COLUMN, it) }
      "aspectRatio" -> value?.toFloatOrNull()?.let { node.aspectRatio = it }
      "overflow" -> node.overflow = when (value) {
        "hidden" -> YogaOverflow.HIDDEN
        "scroll" -> YogaOverflow.SCROLL
        else -> YogaOverflow.VISIBLE
      }
      "display" -> node.display = when (value) {
        "none" -> com.facebook.yoga.YogaDisplay.NONE
        "flex" -> com.facebook.yoga.YogaDisplay.FLEX
        else -> com.facebook.yoga.YogaDisplay.FLEX
      }
    }
  }

  fun layout(rootWidth: Int, rootHeight: Int, views: Map<Int, View>, applyBudgetMs: Double): Boolean {
    if (rootWidth <= 0 || rootHeight <= 0) return true
    val canResume =
      pendingApplyIds != null &&
        !pendingApplyDirty &&
        pendingApplyRootWidth == rootWidth &&
        pendingApplyRootHeight == rootHeight
    if (!canResume) {
      rootNode.setWidth(rootWidth.toFloat())
      rootNode.setHeight(rootHeight.toFloat())
      measureCount = 0
      lastChangedCount = 0
      rootNode.calculateLayout(rootWidth.toFloat(), rootHeight.toFloat())
      // Filter out any IDs that are no longer in the nodes map (safety cleanup)
      pendingApplyIds = ArrayList(nodeIds.filter { nodes.containsKey(it) })
      pendingApplyIndex = 0
      pendingApplyRootWidth = rootWidth
      pendingApplyRootHeight = rootHeight
      pendingApplyDirty = false
    }
    val completed = applyPending(applyBudgetMs)
    if (completed) {
      lastMeasureCount = measureCount
    }
    return completed
  }

  fun nodeCount(): Int = nodes.size
  fun lastLayoutMeasureCount(): Int = lastMeasureCount
  fun lastLayoutChangedCount(): Int = lastChangedCount

  private fun applyPending(applyBudgetMs: Double): Boolean {
    val ids = pendingApplyIds ?: return true
    val budgetNs =
      if (applyBudgetMs <= 0) 0L else (applyBudgetMs * 1_000_000.0).toLong()
    val startNs = System.nanoTime()
    val total = ids.size
    while (pendingApplyIndex < total) {
      val id = ids[pendingApplyIndex]
      pendingApplyIndex += 1
      val node = nodes[id] ?: continue
      val view = node.data as? View ?: continue
      val left = node.layoutX.toInt()
      val top = node.layoutY.toInt()
      val width = node.layoutWidth.toInt()
      val height = node.layoutHeight.toInt()
      val right = left + width
      val bottom = top + height
      val frameChanged =
        view.left != left || view.top != top || view.right != right || view.bottom != bottom
      if (view is ZynthLayoutView) {
        view.updateYogaLayout(width, height)
      }
      if (frameChanged) {
        view.layout(left, top, right, bottom)
        lastChangedCount += 1
        layoutDidUpdate?.invoke(id, left, top, right, bottom, true)
      }
      
      // Check budget every 16 nodes to reduce System.nanoTime overhead
      if (budgetNs > 0 && (pendingApplyIndex % 16 == 0) && System.nanoTime() - startNs >= budgetNs) {
        break
      }
    }
    if (pendingApplyIndex >= total) {
      pendingApplyIds = null
      pendingApplyIndex = 0
      return true
    }
    return false
  }

  private fun createTextMeasure(view: TextView): YogaMeasureFunction {
    return YogaMeasureFunction { _, width, widthMode, height, heightMode ->
      measureCount += 1
      val widthSpec = makeMeasureSpec(width, widthMode)
      val heightSpec = makeMeasureSpec(height, heightMode)
      view.measure(widthSpec, heightSpec)
      YogaMeasureOutput.make(view.measuredWidth.toFloat(), view.measuredHeight.toFloat())
    }
  }

  private fun attachMeasureHandler(node: YogaNode, handler: MeasureHandler) {
    node.setMeasureFunction { _, width, widthMode, height, heightMode ->
      measureCount += 1
      val input = MeasureInput(
        width = width,
        widthMode = widthMode.toMeasureMode(),
        height = height,
        heightMode = heightMode.toMeasureMode(),
      )
      val (measuredWidth, measuredHeight) = handler(input)
      YogaMeasureOutput.make(measuredWidth, measuredHeight)
    }
  }

  private fun makeMeasureSpec(size: Float, mode: YogaMeasureMode): Int {
    val intSize = if (size.isNaN()) 0 else size.toInt()
    return when (mode) {
      YogaMeasureMode.EXACTLY ->
        View.MeasureSpec.makeMeasureSpec(intSize, View.MeasureSpec.EXACTLY)
      YogaMeasureMode.AT_MOST ->
        View.MeasureSpec.makeMeasureSpec(intSize, View.MeasureSpec.AT_MOST)
      else -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    }
  }

  private fun YogaMeasureMode.toMeasureMode(): MeasureMode {
    return when (this) {
      YogaMeasureMode.EXACTLY -> MeasureMode.EXACTLY
      YogaMeasureMode.AT_MOST -> MeasureMode.AT_MOST
      else -> MeasureMode.UNDEFINED
    }
  }

  private fun applyDimension(
    raw: String?,
    set: (Float) -> Unit,
    setPercent: ((Float) -> Unit)?,
    setAuto: (() -> Unit)?
  ) {
    if (raw.isNullOrBlank()) return
    if (raw == "auto") {
      setAuto?.invoke()
      return
    }
    if (raw.endsWith("%")) {
      val percent = raw.dropLast(1).toFloatOrNull()
      if (percent != null) {
        setPercent?.invoke(percent)
      }
      return
    }
    raw.toFloatOrNull()?.let { set(it) }
  }

  private fun parseAlign(value: String?): YogaAlign {
    return when (value) {
      "flex-start" -> YogaAlign.FLEX_START
      "flex-end" -> YogaAlign.FLEX_END
      "center" -> YogaAlign.CENTER
      "stretch" -> YogaAlign.STRETCH
      "baseline" -> YogaAlign.BASELINE
      "space-between" -> YogaAlign.SPACE_BETWEEN
      "space-around" -> YogaAlign.SPACE_AROUND
      else -> YogaAlign.STRETCH
    }
  }
}
