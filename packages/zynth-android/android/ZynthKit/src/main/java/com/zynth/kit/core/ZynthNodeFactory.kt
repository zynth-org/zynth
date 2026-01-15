package com.zynth.kit.core

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.util.Log
import android.util.SparseArray
import android.view.Gravity
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import com.zynth.kit.components.ZynthComponentRegistry
import com.zynth.kit.layout.LayoutEngine
import com.zynth.kit.layout.MeasureInput
import com.zynth.kit.layout.MeasureMode
import com.zynth.kit.layout.Style
import kotlin.math.roundToInt

/**
 * ZynthNodeFactory handles all node creation, removal, and lifecycle operations for the Zynth UI framework.
 * 
 * Responsibilities:
 * - Node creation for all core component types (TEXT, IMAGE)
 * - Node removal and recursive cleanup
 * - Text node utilities (virtual text detection, text recomputation)
 * - Node measurement configuration
 */
internal class ZynthNodeFactory(
  private val root: ZynthRootView,
  private val surfaceId: Int,
  private val nodes: SparseArray<ZynthUIManager.Node>,
    private val engine: LayoutEngine,
    private val pendingTextRebuild: LinkedHashSet<Int>,
    private val nodeRecyclingPool: NodeRecyclingPool,
    private val getNextId: () -> Int,
    private val incrementNextId: () -> Unit,
    private val scheduleFlush: (FlushPriority) -> Unit,
    private val logDebug: (String, String) -> Unit,
    private val manager: ZynthUIManager,
) {

  // Fast enum-based dispatch to avoid repeated string comparisons in createNode


  // Component type constants
  private val TEXT_TYPE = "text"

  // ==================== Text Node Helpers ====================

  /**
   * Detects if a node is a virtual text node (TEXT type with TEXT parent).
   * Virtual text nodes are merged into parent text instead of creating view hierarchy.
   */
  internal fun isVirtualTextNode(node: ZynthUIManager.Node): Boolean {
    val parent = node.parentId?.let { nodes.get(it) }
    return node.type == TEXT_TYPE && parent?.type == TEXT_TYPE
  }

  /**
   * Recomputes text content for a node and its children recursively.
   * For TEXT nodes: concatenates text from all text children.
   * For other nodes: returns the label text or view text.
   */
  internal fun recomputeTextForNode(node: ZynthUIManager.Node?): String {
    if (node == null) return ""
    if (node.type != TEXT_TYPE) {
      return node.label?.text?.toString()
        ?: (node.view as? TextView)?.text?.toString()
        ?: node.cachedText
    }
    if (node.textChildren.isEmpty()) {
      return node.cachedText
    }
    val builder = StringBuilder()
    node.textChildren.forEach { childId ->
      val childText = recomputeTextForNode(nodes.get(childId))
      builder.append(childText)
    }
    return builder.toString()
  }

  /**
   * Propagates text change through current node and any TEXT ancestors.
   * Ensures each affected node is marked for rebuild so Yoga remeasures widths
   * when font metrics change (e.g., fontWeight toggles on tab labels).
   */
  internal fun propagateTextChange(node: ZynthUIManager.Node) {
    var current: ZynthUIManager.Node? = node
    while (current != null && current.type == TEXT_TYPE) {
      pendingTextRebuild.add(current.id)
      try {
        engine.markDirty(current.id)
      } catch (_: Throwable) {
        // Ignore markDirty failures for TEXT nodes
      }
      current = current.parentId?.let { nodes.get(it) }
    }
  }

  /**
   * Combined recompute and propagate operation.
   * Adds node to rebuild queue and propagates changes upward.
   */
  internal fun recomputeAndPropagate(node: ZynthUIManager.Node) {
    propagateTextChange(node)
  }

  /**
   * Resolves a text node by walking up the hierarchy to find a node with a label.
   * Used to find the actual TextView for a virtual text node.
   */
  internal fun resolveTextNode(id: Int): ZynthUIManager.Node? {
    var currentId: Int? = id
    while (currentId != null) {
      val node = nodes.get(currentId)
      if (node?.label != null || node?.view is TextView) return node
      currentId = nodes.get(currentId)?.parentId
    }
    return nodes.get(id)
  }

  // ==================== TextInput State Management ====================

  // ==================== Measurement ====================

  // ==================== Node Creation ====================

  /**
   * Creates a new node of the specified type.
   * Components are created via the component registry. Unknown types fall back to a basic FrameLayout.
   * 
   * Returns the newly created node's ID.
   */
  internal fun createNode(type: String, explicitId: Int? = null): Int {
    val id = explicitId ?: run {
      val generated = getNextId()
      incrementNextId()
      generated
    }

    val descriptor = ZynthComponentRegistry.getDescriptor(type)
    val view: View
    val label: TextView?

    if (descriptor != null) {
      // Step 1: Create view via descriptor
      view = descriptor.createView(root.context, id)
      label = view as? TextView
    } else {
      // Fallback: create a basic FrameLayout for unknown types
      android.util.Log.w("ZynthKit", "No descriptor found for type '$type', using fallback FrameLayout")
      view = FrameLayout(root.context)
      label = null
    }

    // Step 2: Apply appropriate layout params
    if (view.layoutParams == null) {
      view.layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
    }
    view.setBackgroundColor(Color.TRANSPARENT)
    if (view is ViewGroup) {
      view.clipChildren = false
      view.clipToPadding = false
    }

    // Step 3: Create node and register
    val node = ZynthUIManager.Node(id, type, view, label)
    node.surfaceId = surfaceId
    node.cachedText = (label?.text?.toString() ?: "")
    node.mountAwaitingFirstProps = true
    node.mountHasVisualProps = false
    node.mountStartTimeMs = 0L
    nodes.put(id, node)
    manager.onNodeCreated(id, surfaceId)
    node.parentId = null
    engine.createNode(id)

    // Step 4: Call descriptor's onNodeCreated hook if available
    if (descriptor != null) {
      descriptor.onNodeCreated(manager, node)
    } else {
      // Fallback: set default width for non-text views
      if (label == null) {
        try {
          engine.setStyle(id, Style(widthPercent = 100f))
        } catch (_: Throwable) {
          // Defensive: style application should never crash creation
        }
      }
    }

    return id
  }

  // ==================== Node Removal ====================

  /**
   * Removes a node and all its children recursively.
   * Handles cleanup for all component types (IMAGE, TEXT_INPUT, SCROLL_VIEW, BUTTON).
   * Removes from view hierarchy and engine tracking.
   */
  internal fun removeNodeRecursive(id: Int, detachView: Boolean = true) {
    if (id == root.rootId) return

    val node = nodes.get(id)
    if (node == null) {
      // Node may have been removed earlier (e.g., merged text child).
      // Ensure we still clear parent mapping to avoid stale references.
      // Node is already absent; nothing to cleanup.
      return
    }

    // First, recursively remove all children (use per-node children list)
    val childrenToRemove = node.children?.toList() ?: emptyList()
    childrenToRemove.forEach { childId ->
      removeNodeRecursive(childId, detachView)
    }

    // Clean up from parent's textChildren if this is a text child
    node.parentId?.let { parentId ->
      nodes.get(parentId)?.textChildren?.remove(id)
    }

    // Type-specific cleanup
    node.layoutListener?.let {
      node.view.removeOnLayoutChangeListener(it)
      node.layoutListener = null
    }
    node.hasOnLayoutHandler = false

    // Clean up view: remove click listener and from parent
    node.view.setOnClickListener(null)
    node.view.isClickable = false
    if (detachView) {
      (node.view.parent as? ViewGroup)?.removeView(node.view)
    }

    // Clean up layout engine
    engine.setMeasureHandler(id, null)
    engine.removeNode(id)

    // Remove from our tracking maps
    nodes.remove(id)
    manager.onNodeRemoved(id)
    node.parentId = null

    // Also clean up from any pending text rebuilds
    pendingTextRebuild.remove(id)
  }

  // ==================== Node Recycling ====================

  /**
   * Reset a recycled node to clean state for reuse.
   * Clears all state that might persist from previous use.
   */
  internal fun resetRecycledNodeState(
    node: ZynthUIManager.Node,
    type: String,
  ) {
    ZynthComponentRegistry.getDescriptor(type)?.onReset?.invoke(node)

    // Clear common state
    node.view.setBackgroundColor(Color.TRANSPARENT)
    node.pointerEvents = "auto"
    node.hasOnLayoutHandler = false
    node.layoutListener?.let {
      node.view.removeOnLayoutChangeListener(it)
    }
    node.layoutListener = null
    node.cachedText = ""
    node.children?.clear()
    node.parentId = null
    node.index = -1
    node.hasCompletedInitialMount = false
    node.measuredFrame = null
    node.lastLayoutX = Int.MIN_VALUE
    node.lastLayoutY = Int.MIN_VALUE
    node.lastLayoutWidth = -1
    node.lastLayoutHeight = -1
  }
}
