package com.zynth.kit.core

import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.layout.LayoutEngine
import com.zynth.kit.layout.MeasureHandler
import com.zynth.kit.layout.Rect as LayoutRect
import com.zynth.kit.layout.Style
import com.zynth.kit.layout.ZynthYogaLayout
import com.zynth.kit.runtime.JSBridge
import org.json.JSONObject

class ZynthUIManager(internal val rootView: ZynthRootView) : ZynthEventSink {
  internal val mainHandler = Handler(Looper.getMainLooper())
  internal val density = rootView.resources.displayMetrics.density
  internal var nextId = 1
  internal val nodes = HashMap<Int, View>()
  internal val nodeStates = HashMap<Int, Node>()
  internal val parents = HashMap<Int, Int>()
  internal val nodeSurfaces = HashMap<Int, Int>()
  internal val surfaceRoots = HashMap<Int, ViewGroup>()
  internal val surfaceYoga = HashMap<Int, ZynthYogaLayout>()
  internal val dirtySurfaces = HashSet<Int>()
  internal val surfaceSizes = HashMap<Int, Pair<Int, Int>>()
  internal var activeSurfaceId = 0
  internal val styleStates = HashMap<Int, ZynthViewStyleState>()
  internal val styleDirtyNodes = HashSet<Int>()
  internal val styleLayoutDirtyNodes = HashSet<Int>()
  internal val styleLayoutFrames = HashMap<Int, android.graphics.Rect>()
  internal val textStyleStates = HashMap<Int, ZynthTextStyleState>()
  internal val pointerEvents = HashMap<Int, String>()
  internal val pressNodes = HashSet<Int>()
  internal val longPressNodes = HashSet<Int>()
  internal val doublePressNodes = HashSet<Int>()
  internal val activePressNodes = HashSet<Int>()
  internal val longPressFired = HashSet<Int>()
  internal val longPressDurations = HashMap<Int, Double>()
  internal val doublePressWindows = HashMap<Int, Double>()
  internal val lastPressTimestamps = HashMap<Int, Double>()
  internal val pressLocalPoints = HashMap<Int, Pair<Float, Float>>()
  internal val pressScreenPoints = HashMap<Int, Pair<Float, Float>>()
  internal val longPressRunnables = HashMap<Int, Runnable>()
  internal val touchListeners = HashMap<Int, View.OnTouchListener>()
  internal val layoutNodes = HashSet<Int>()
  internal val layoutPending = HashSet<Int>()
  internal val layoutFrames = HashMap<Int, android.graphics.Rect>()
  internal var choreographer: Choreographer? = null
  internal var frameCallbackPosted = false
  internal var needsLayout = false
  internal var frameInProgress = false
  internal var didWarmup = false
  internal var budgetOverruns = 0
  internal var lastLayoutMs = 0.0
  internal var lastFrameMs = 0.0
  internal var frameProfiler: ((Double, Double, Boolean, Int) -> Unit)? = null
  internal val frameCallback = Choreographer.FrameCallback { handleFrame() }
  private val layoutEngine: LayoutEngine = LayoutEngineAdapter()

  data class Node(
    val id: Int,
    val type: String,
    val view: View,
    val label: TextView? = null,
    val textChildren: MutableList<Int> = mutableListOf(),
    var cachedText: String = "",
    var pointerEvents: String = "auto",
    val attachments: MutableMap<String, Any?> = mutableMapOf(),
    var mountHasVisualProps: Boolean = false,
    var mountAwaitingFirstProps: Boolean = false,
  )

  init {
    ensureSurface(0)
    rootView.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
      if (left != oldLeft || top != oldTop || right != oldRight || bottom != oldBottom) {
        markAllSurfacesDirty()
      }
    }
  }

  internal fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }

  fun setFrameProfiler(profiler: ((frameMs: Double, layoutMs: Double, overBudget: Boolean, nodeCount: Int) -> Unit)?) {
    setFrameProfilerInternal(profiler)
  }

  fun createNode(type: String): Int {
    val id = nextId++
    val descriptor = ZynthComponentRegistry.getDescriptor(type)
    val view = descriptor?.createView?.invoke(rootView.context, id) ?: run {
      if (type == "text") {
        TextView(rootView.context).apply { text = "" }
      } else {
        ZynthLayoutView(rootView.context)
      }
    }
    nodes[id] = view
    val node = Node(
      id = id,
      type = type,
      view = view,
      label = view as? TextView,
    )
    nodeStates[id] = node
    pointerEvents[id] = "auto"
    nodeSurfaces[id] = activeSurfaceId
    yogaForSurface(activeSurfaceId).ensureNode(id, view)
    markSurfaceDirty(activeSurfaceId)
    descriptor?.onNodeCreated?.invoke(this, node)
    return id
  }

  fun setProp(id: Int, name: String, value: String?) {
    val view = nodes[id] ?: return
    val node = nodeStates[id]
    val descriptor = node?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (node != null && descriptor?.applyProperty?.invoke(node, name, value) == true) {
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (applyStyleProp(id, view, name, value)) {
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (name == "color" && view is TextView) {
      ZynthColorParser.parse(value)?.let { color ->
        runOnMain { view.setTextColor(color) }
      }
      return
    }
    if (name == "pointerEvents") {
      if (value.isNullOrBlank()) {
        pointerEvents.remove(id)
        nodeStates[id]?.pointerEvents = "auto"
      } else {
        pointerEvents[id] = value
        nodeStates[id]?.pointerEvents = value
      }
      updateInteractionState(id)
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (name == "delayLongPressMs") {
      val duration = value?.toDoubleOrNull()
      if (duration == null) {
        longPressDurations.remove(id)
      } else {
        longPressDurations[id] = duration
      }
      return
    }
    if (name == "doublePressWindowMs") {
      val window = value?.toDoubleOrNull()
      if (window == null) {
        doublePressWindows.remove(id)
      } else {
        doublePressWindows[id] = window
      }
      return
    }
    if (name == "enableDoublePress") {
      val enabled = value?.lowercase() == "true" || value == "1"
      if (enabled) {
        doublePressNodes.add(id)
      } else {
        doublePressNodes.remove(id)
      }
      return
    }
    if (name == "opacity") {
      val alpha = value?.toFloatOrNull() ?: return
      runOnMain { view.alpha = alpha }
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (view is TextView && name == "fontSize") {
      val size = value?.toFloatOrNull() ?: return
      runOnMain { view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, dpToPx(size)) }
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (view is TextView && name == "fontWeight") {
      val weight = value ?: return
      val style = if (weight == "bold" || weight == "700" || weight == "600") {
        Typeface.BOLD
      } else {
        Typeface.NORMAL
      }
      runOnMain { view.setTypeface(view.typeface, style) }
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (view is TextView && name == "fontStyle") {
      val style = if (value == "italic") Typeface.ITALIC else Typeface.NORMAL
      runOnMain { view.setTypeface(view.typeface, style) }
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (view is TextView && name == "fontFamily") {
      val family = value ?: return
      runOnMain { view.typeface = Typeface.create(family, view.typeface?.style ?: Typeface.NORMAL) }
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (view is TextView && name == "textAlign") {
      val gravity = when (value) {
        "center" -> Gravity.CENTER_HORIZONTAL
        "right" -> Gravity.END
        "left" -> Gravity.START
        else -> Gravity.START
      }
      runOnMain { view.gravity = gravity }
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (name == "width") {
      yogaForNode(id).setStyle(id, "width", scaleYogaValue(name, value))
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (name == "height") {
      yogaForNode(id).setStyle(id, "height", scaleYogaValue(name, value))
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    if (name == "flexDirection") {
      yogaForNode(id).setStyle(id, "flexDirection", value)
      markSurfaceDirtyForNode(id)
      maybeNotifyStyle(descriptor, node, name, value)
      return
    }
    yogaForNode(id).setStyle(id, name, scaleYogaValue(name, value))
    markSurfaceDirtyForNode(id)
    maybeNotifyStyle(descriptor, node, name, value)
  }

  fun setText(id: Int, text: String) {
    val view = nodes[id]
    nodeStates[id]?.cachedText = text
    val node = nodeStates[id]
    val descriptor = node?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (node != null) {
      descriptor?.applyProperty?.invoke(node, "text", text)
    }
    if (view is TextView) {
      runOnMain { applyTextValue(id, view, text) }
      yogaForNode(id).markDirty(id)
      markSurfaceDirtyForNode(id)
      val parentId = parents[id]
      if (parentId != null) {
        val parent = nodes[parentId]
        if (parent is TextView) {
          runOnMain { applyTextValue(parentId, parent, text) }
          yogaForNode(parentId).markDirty(parentId)
          markSurfaceDirtyForNode(parentId)
        }
      }
    }
  }

  fun insertChild(parentId: Int, childId: Int, index: Int) {
    val child = nodes[childId] ?: return
    val parentState = nodeStates[parentId]
    if (parentState != null && parentState.type == "text") {
      parentState.textChildren.add(childId)
    }
    val surfaceId = if (parentId == 0) {
      activeSurfaceId
    } else {
      nodeSurfaces[parentId] ?: activeSurfaceId
    }
    val parent = if (parentId == 0) rootViewForSurface(surfaceId) else nodes[parentId]
    parents[childId] = parentId
    nodeSurfaces[childId] = surfaceId
    if (parent is TextView && child is TextView) {
      runOnMain { parent.text = child.text }
      yogaForNode(parentId).markDirty(parentId)
      markSurfaceDirty(surfaceId)
      return
    }
    val group = parent as? ViewGroup
    if (group == null) {
      yogaForSurface(surfaceId).insertChild(parentId, childId, index)
      return
    }
    runOnMain {
      val targetIndex = index.coerceIn(0, group.childCount)
      group.addView(child, targetIndex)
    }
    yogaForSurface(surfaceId).insertChild(parentId, childId, index)
    markSurfaceDirty(surfaceId)
  }

  fun removeChild(parentId: Int, childId: Int) {
    val child = nodes[childId] ?: return
    nodeStates[parentId]?.textChildren?.remove(childId)
    cleanupNode(childId)
    parents.remove(childId)
    runOnMain { (child.parent as? ViewGroup)?.removeView(child) }
    yogaForNode(childId).removeChild(parentId, childId)
    markSurfaceDirtyForNode(childId)
  }

  fun setHandler(id: Int, name: String) {
    val node = nodeStates[id]
    val descriptor = node?.let { ZynthComponentRegistry.getDescriptor(it.type) }
    if (node != null && descriptor?.onSetHandler?.invoke(node, name) == true) {
      return
    }
    if (name == "onPress" || name == "onPressIn" || name == "onPressOut" ||
      name == "onLongPress" || name == "onDoublePress"
    ) {
      pressNodes.add(id)
      if (name == "onLongPress") {
        longPressNodes.add(id)
      }
      if (name == "onDoublePress") {
        doublePressNodes.add(id)
      }
      attachTouchListener(id)
      updateInteractionState(id)
      return
    }
    if (name == "onLayout") {
      layoutNodes.add(id)
      layoutPending.add(id)
      requestLayout()
      return
    }
  }

  override fun dispatchEvent(nodeId: Int, event: String, payload: org.json.JSONObject?) {
    val json = payload?.toString()
    runCatching {
      JSBridge.invokeEvent(nodeId, event, json)
    }
  }

  fun getLayoutEngine(): LayoutEngine = layoutEngine

  fun getRootView(): ZynthRootView = rootView

  fun getNodeState(nodeId: Int): Node? = nodeStates[nodeId]

  fun getParentId(nodeId: Int): Int? = parents[nodeId]

  fun setMeasureHandler(nodeId: Int, handler: MeasureHandler?) {
    layoutEngine.setMeasureHandler(nodeId, handler)
    if (handler != null) {
      layoutEngine.markDirty(nodeId)
    }
  }

  /**
   * Mark a node as dirty so its intrinsic size can be remeasured.
   * Used by components when text or content changes.
   */
  fun markNodeDirty(nodeId: Int) {
    layoutEngine.markDirty(nodeId)
    requestLayout()
  }


  fun applyBatch(json: String) {
    json.length
  }

  fun setSurface(surfaceId: Int) {
    ensureSurface(surfaceId)
    activeSurfaceId = surfaceId
    markSurfaceDirty(surfaceId)
  }

  fun flush() {
    markSurfaceDirty(activeSurfaceId)
    requestLayout()
  }

  private fun requestLayout() {
    requestLayoutInternal()
  }

  private fun ensureChoreographer() {
    ensureChoreographerInternal()
  }

  internal fun dpToPx(value: Float): Float = if (density == 0f) value else value * density

  internal fun pxToDp(value: Float): Double = if (density == 0f) value.toDouble() else (value / density).toDouble()

  private fun scaleYogaValue(name: String, value: String?): String? {
    if (value.isNullOrBlank()) return value
    val trimmed = value.trim()
    if (trimmed == "auto" || trimmed.endsWith("%")) return value
    val numeric = trimmed.removeSuffix("px").toFloatOrNull() ?: return value
    val shouldScale = when (name) {
      "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
      "flexBasis", "top", "right", "bottom", "left",
      "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingRight",
      "paddingBottom", "paddingLeft", "margin", "marginHorizontal", "marginVertical",
      "marginTop", "marginRight", "marginBottom", "marginLeft", "gap", "rowGap",
      "columnGap" -> true
      else -> false
    }
    return if (shouldScale) dpToPx(numeric).toString() else value
  }

  private inner class LayoutEngineAdapter : LayoutEngine {
    override fun createNode(id: Int) {
      nodes[id]?.let { yogaForNode(id).ensureNode(id, it) }
    }

    override fun removeNode(id: Int) {
      yogaForNode(id).removeNode(id)
    }

    override fun insertChild(parent: Int, child: Int, index: Int) {
      yogaForNode(child).insertChild(parent, child, index)
    }

    override fun setStyle(id: Int, style: com.zynth.kit.layout.Style) {
      style
    }

    override fun calculateLayout(width: Int, height: Int) {
      width
      height
    }

    override fun calculateLayoutForNode(nodeId: Int, width: Float, height: Float) {
      nodeId
      width
      height
    }

    override fun frame(id: Int): LayoutRect {
      val view = nodes[id] ?: return LayoutRect(0, 0, 0, 0)
      return LayoutRect(view.left, view.top, view.right, view.bottom)
    }

    override fun getAllFrames(): Map<Int, LayoutRect> {
      val frames = HashMap<Int, LayoutRect>(nodes.size)
      for ((id, view) in nodes) {
        frames[id] = LayoutRect(view.left, view.top, view.right, view.bottom)
      }
      return frames
    }

    override fun setMeasureHandler(id: Int, handler: MeasureHandler?) {
      yogaForNode(id).setMeasureHandler(id, handler)
    }

    override fun markDirty(id: Int) {
      yogaForNode(id).markDirty(id)
      markSurfaceDirtyForNode(id)
    }
  }

  private fun maybeNotifyStyle(
    descriptor: com.zynth.kit.components.ZynthComponentDescriptor?,
    node: Node?,
    name: String,
    value: String?
  ) {
    if (descriptor == null || node == null || value == null) return
    val style = styleFromProp(name, value) ?: return
    descriptor.onStyleApplied(node, style)
  }

  private fun styleFromProp(name: String, rawValue: String): Style? {
    val trimmed = rawValue.trim()
    val jsonValue = when {
      trimmed.isEmpty() -> JSONObject.quote("")
      trimmed == "true" || trimmed == "false" -> trimmed
      trimmed.toDoubleOrNull() != null -> trimmed
      trimmed.startsWith("{") || trimmed.startsWith("[") -> trimmed
      else -> JSONObject.quote(trimmed)
    }
    val json = "{\"$name\":$jsonValue}"
    return runCatching { Style.fromJson(json) }.getOrNull()
  }
}
