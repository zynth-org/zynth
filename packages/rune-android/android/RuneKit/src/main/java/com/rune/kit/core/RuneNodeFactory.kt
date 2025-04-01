package com.rune.kit.core

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
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.MeasureInput
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Style
import kotlin.math.roundToInt

/**
 * RuneNodeFactory handles all node creation, removal, and lifecycle operations for the Rune UI framework.
 * 
 * Responsibilities:
 * - Node creation for all core component types (TEXT, IMAGE)
 * - Node removal and recursive cleanup
 * - Text node utilities (virtual text detection, text recomputation)
 * - Node measurement configuration
 */
internal class RuneNodeFactory(
  private val root: RuneRootView,
  private val nodes: SparseArray<RuneUIManager.Node>,
    private val engine: LayoutEngine,
    private val imageSupport: RuneImageSupport,
    private val pendingTextRebuild: LinkedHashSet<Int>,
    private val nodeRecyclingPool: NodeRecyclingPool,
    private val getNextId: () -> Int,
    private val incrementNextId: () -> Unit,
    private val scheduleFlush: (FlushPriority) -> Unit,
    private val logDebug: (String, String) -> Unit,
    private val manager: RuneUIManager,
) {

  // Fast enum-based dispatch to avoid repeated string comparisons in createNode
  private enum class NodeType {
    TEXT,
    IMAGE,
    OTHER;

    companion object {
      private val MAP: Map<String, NodeType> = mapOf(
        "text" to TEXT,
        "image" to IMAGE,
      )

      fun fromString(type: String?): NodeType = MAP[type] ?: OTHER
    }
  }

  // Component type constants
  private val TEXT_TYPE = "text"
  private val IMAGE_TYPE = "image"

  // ==================== Text Node Helpers ====================

  /**
   * Detects if a node is a virtual text node (TEXT type with TEXT parent).
   * Virtual text nodes are merged into parent text instead of creating view hierarchy.
   */
  internal fun isVirtualTextNode(node: RuneUIManager.Node): Boolean {
    val parent = node.parentId?.let { nodes.get(it) }
    return node.type == TEXT_TYPE && parent?.type == TEXT_TYPE
  }

  /**
   * Recomputes text content for a node and its children recursively.
   * For TEXT nodes: concatenates text from all text children.
   * For other nodes: returns the label text or view text.
   */
  internal fun recomputeTextForNode(node: RuneUIManager.Node?): String {
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
   * Propagates text change upward through TEXT node hierarchy.
   * Marks all parent TEXT nodes as dirty and adds to rebuild queue.
   */
  internal fun propagateTextChange(node: RuneUIManager.Node) {
    var currentParentId = node.parentId
    while (currentParentId != null) {
      val parent = nodes.get(currentParentId) ?: break
      if (parent.type != TEXT_TYPE) break
      pendingTextRebuild.add(parent.id)
      engine.markDirty(parent.id)
      currentParentId = parent.parentId
    }
  }

  /**
   * Combined recompute and propagate operation.
   * Marks node dirty, adds to rebuild queue, and propagates changes upward.
   */
  internal fun recomputeAndPropagate(node: RuneUIManager.Node) {
    pendingTextRebuild.add(node.id)
    engine.markDirty(node.id)
    propagateTextChange(node)
  }

  /**
   * Resolves a text node by walking up the hierarchy to find a node with a label.
   * Used to find the actual TextView for a virtual text node.
   */
  internal fun resolveTextNode(id: Int): RuneUIManager.Node? {
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

  // Small sealed interface to encapsulate view creation and per-node registration
  private sealed interface ViewCreator {
    fun create(context: android.content.Context, id: Int): View
    fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node)
  }

  private object TextCreator : ViewCreator {
    override fun create(context: android.content.Context, id: Int): View {
      return TextView(context).apply {
        textSize = 16f
        setTextColor(Color.WHITE)
        gravity = Gravity.START
      }
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      // measurement handler registered later in createNode using label != null path, so nothing to do here
    }
  }

  private object ImageCreator : ViewCreator {
    override fun create(context: android.content.Context, id: Int): View {
      return ImageView(context).apply {
        adjustViewBounds = true
        scaleType = ImageView.ScaleType.CENTER_CROP
        setBackgroundColor(Color.TRANSPARENT)
      }
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      // imageSupport initialization for node happens in createNode after node creation
    }
  }

  private object ScrollViewCreator : ViewCreator {
    override fun create(context: android.content.Context, id: Int): View {
      return FrameLayout(context)
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      // nothing extra
    }
  }

  private object OtherCreator : ViewCreator {
    override fun create(context: android.content.Context, id: Int): View {
      return FrameLayout(context)
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      // nothing extra
    }
  }

  private fun getViewCreator(type: NodeType): ViewCreator = when (type) {
    NodeType.TEXT -> TextCreator
    NodeType.IMAGE -> ImageCreator
    NodeType.OTHER -> OtherCreator
  }

  /**
   * Creates a new node of the specified type.
   * Handles view creation, initialization, and measurement handler setup for core component types:
   * TEXT, IMAGE. Custom components are created via the component registry.
   * 
   * Returns the newly created node's ID.
   */
  internal fun createNode(type: String): Int {
    val id = getNextId()
    incrementNextId()

    val descriptor = RuneComponentRegistry.getDescriptor(type)
    val view: View
    val label: TextView?
    val creator: ViewCreator?

    if (descriptor != null) {
      creator = null
      view = descriptor.createView(root.context, id)
      label = view as? TextView
    } else {
      val selectedCreator = getViewCreator(NodeType.fromString(type))
      creator = selectedCreator
      view = selectedCreator.create(root.context, id)
      label = view as? TextView
    }

    // Step 2: Apply appropriate layout params based on type
    when (type) {
      TEXT_TYPE -> {
        view.layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
      }
      else -> {
        if (view.layoutParams == null) {
          view.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
          )
        }
        if (descriptor == null) {
          view.isClickable = false
        }
      }
    }
    view.setBackgroundColor(Color.TRANSPARENT)

    // Step 3: Create node and register
    val node = RuneUIManager.Node(id, type, view, label)
    node.cachedText = (label?.text?.toString() ?: "")
    if (type == IMAGE_TYPE) {
      imageSupport.initializeNode(node)
    }
    nodes.put(id, node)
    node.parentId = null
    engine.createNode(id)

    if (descriptor != null) {
      descriptor.onNodeCreated(manager, node)
    } else {
      creator?.registerHandlers(this, id, view, node)
    }

    // Step 4: Set default width for non-text views
    if (label == null) {
      try {
        engine.setStyle(id, Style(widthPercent = 100f))
      } catch (_: Throwable) {
        // Defensive: style application should never crash creation
      }
    }

    // Step 5: Configure measurement handlers
    if (label != null) {
      engine.setMeasureHandler(id) { input ->
        val widthValue = when {
          input.width.isNaN() -> 0
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        }
        val heightValue = when {
          input.height.isNaN() -> 0
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        }
        val widthSpec = when (input.widthMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(widthValue, MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        val heightSpec = when (input.heightMode) {
          MeasureMode.EXACTLY -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.EXACTLY)
          MeasureMode.AT_MOST -> MeasureSpec.makeMeasureSpec(heightValue, MeasureSpec.AT_MOST)
          MeasureMode.UNDEFINED -> MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
        }
        label.measure(widthSpec, heightSpec)
        val measuredWidth = label.measuredWidth.coerceAtLeast(1)
        val measuredHeight = label.measuredHeight.coerceAtLeast((label.textSize * 1.2f).roundToInt())
        measuredWidth.toFloat() to measuredHeight.toFloat()
      }
    } else if (type == IMAGE_TYPE) {
      engine.setMeasureHandler(id) { input ->
        imageSupport.measure(node, input)
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
    if (node.type == IMAGE_TYPE) {
      imageSupport.cleanup(node)
    }
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
    node: RuneUIManager.Node,
    type: String,
  ) {
    when (type) {
      TEXT_TYPE -> {
        node.label?.text = ""
        node.cachedText = ""
        node.textChildren.clear()
      }
      IMAGE_TYPE -> {
        val image = node.view as? ImageView ?: return
        image.setImageDrawable(null)
        node.imageState = null
      }
    }

    RuneComponentRegistry.getDescriptor(type)?.onReset?.invoke(node)

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
