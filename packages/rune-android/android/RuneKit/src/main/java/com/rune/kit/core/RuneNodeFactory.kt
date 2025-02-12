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
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.MeasureInput
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Style
import kotlin.math.roundToInt

/**
 * RuneNodeFactory handles all node creation, removal, and lifecycle operations for the Rune UI framework.
 * 
 * Responsibilities:
 * - Node creation for all component types (TEXT, TEXT_INPUT, IMAGE, SCROLL_VIEW, BUTTON, PRESSABLE)
 * - Node removal and recursive cleanup
 * - TextInput state management
 * - Text node utilities (virtual text detection, text recomputation)
 * - Node measurement configuration
 */
internal class RuneNodeFactory(
    private val root: RuneRootView,
    private val nodes: SparseArray<RuneUIManager.Node>,
    private val parents: HashMap<Int, Int?>,
    private val engine: LayoutEngine,
    private val imageSupport: RuneImageSupport,
    private val buttonStyles: SparseArray<ButtonVisualStyle>,
    private val pendingTextRebuild: LinkedHashSet<Int>,
    private val getNextId: () -> Int,
    private val incrementNextId: () -> Unit,
    private val scheduleFlush: (FlushPriority) -> Unit,
    private val deriveButtonVisualStyle: (Style, ButtonVisualStyle?, RuneButtonView) -> ButtonVisualStyle,
    private val applyVisualStyle: (RuneButtonView, ButtonVisualStyle) -> Unit,
    private val logDebug: (String, String) -> Unit,
    private val onTextInputIntrinsicSizeChanged: (Int) -> Unit,
    private val manager: RuneUIManager,
) {

  // Fast enum-based dispatch to avoid repeated string comparisons in createNode
  private enum class NodeType {
    TEXT,
    TEXT_INPUT,
    SECURE_TEXT_INPUT,
    IMAGE,
    SCROLL_VIEW,
    BUTTON,
    PRESSABLE,
    OTHER;

    companion object {
      private val MAP: Map<String, NodeType> = mapOf(
        "text" to TEXT,
        "text-input" to TEXT_INPUT,
        "secure-text-input" to SECURE_TEXT_INPUT,
        "image" to IMAGE,
        "scroll-view" to SCROLL_VIEW,
        "button" to BUTTON,
        "pressable" to PRESSABLE,
      )

      fun fromString(type: String?): NodeType = MAP[type] ?: OTHER
    }
  }

  // Component type constants
  private val TEXT_TYPE = "text"
  private val IMAGE_TYPE = "image"
  private val TEXT_INPUT_TYPE = "text-input"
  private val SECURE_TEXT_INPUT_TYPE = "secure-text-input"
  private val SCROLL_VIEW_TYPE = "scroll-view"
  private val BUTTON_TYPE = "button"
  private val PRESSABLE_TYPE = "pressable"

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
      currentId = parents[currentId]
    }
    return nodes.get(id)
  }

  // ==================== TextInput State Management ====================

  /**
   * Ensures a node has a TextInputState object.
   * Creates one if it doesn't exist and returns it.
   */
  internal fun ensureTextInputState(node: RuneUIManager.Node): RuneUIManager.TextInputState {
    val existing = node.textInputState
    if (existing != null) return existing
    val created = RuneUIManager.TextInputState()
    node.textInputState = created
    return created
  }

  /**
   * Cleans up a TextInput node's state and references.
   * Clears handlers, removes manager reference, and nullifies state.
   */
  internal fun cleanupTextInput(node: RuneUIManager.Node) {
    (node.view as? RuneTextInputView)?.let { input ->
      input.clearHandlers()
      input.manager = null
      input.nodeId = -1
    }
    node.textInputState = null
  }

  // ==================== Measurement ====================

  /**
   * Measures a TextInput view and returns width/height pair.
   * Uses cached exact height if available.
   */
  internal fun measureTextInput(view: RuneTextInputView, input: MeasureInput): Pair<Float, Float> {
    val node = nodes.get(view.nodeId)
    if (node != null) {
      val state = ensureTextInputState(node)
      if (state.lastExactHeight > 0) {
        view.setExpectedExactHeight(state.lastExactHeight)
      }
    }
    val widthSpec = when (input.widthMode) {
      MeasureMode.EXACTLY -> View.MeasureSpec.makeMeasureSpec(
        when {
          input.width.isNaN() -> 0
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        },
        View.MeasureSpec.EXACTLY,
      )
      MeasureMode.AT_MOST -> View.MeasureSpec.makeMeasureSpec(
        when {
          input.width.isNaN() -> Int.MAX_VALUE / 2
          input.width.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.width.roundToInt()
        },
        View.MeasureSpec.AT_MOST,
      )
      MeasureMode.UNDEFINED -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    }

    val heightSpec = when (input.heightMode) {
      MeasureMode.EXACTLY -> View.MeasureSpec.makeMeasureSpec(
        when {
          input.height.isNaN() -> 0
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        },
        View.MeasureSpec.EXACTLY,
      )
      MeasureMode.AT_MOST -> View.MeasureSpec.makeMeasureSpec(
        when {
          input.height.isNaN() -> Int.MAX_VALUE / 2
          input.height.isInfinite() -> Int.MAX_VALUE / 2
          else -> input.height.roundToInt()
        },
        View.MeasureSpec.AT_MOST,
      )
      MeasureMode.UNDEFINED -> View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    }

    view.measure(widthSpec, heightSpec)

    val targetWidth = if (input.widthMode == MeasureMode.EXACTLY) {
      View.MeasureSpec.getSize(widthSpec)
    } else {
      view.measuredWidth
    }.coerceAtLeast(1)

    val targetHeight = when (input.heightMode) {
      MeasureMode.EXACTLY -> View.MeasureSpec.getSize(heightSpec)
      MeasureMode.AT_MOST, MeasureMode.UNDEFINED -> view.measuredHeight
    }.coerceAtLeast(1)

    return targetWidth.toFloat() to targetHeight.toFloat()
  }

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

  private object TextInputCreator : ViewCreator {
    override fun create(context: android.content.Context, id: Int): View {
      return RuneTextInputView(context).apply {
        nodeId = id
        applyEditable(true)
        applyMultiline(false)
        applyNumberOfLines(0)
        submitBehavior = "submit"
        blurOnSubmit = false
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
      }
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      (view as? RuneTextInputView)?.let {
        it.manager = factory.manager
        it.nodeId = id
      }
    }
  }

  private object SecureTextInputCreator : ViewCreator {
    override fun create(context: android.content.Context, id: Int): View {
      return RuneSecureTextInputView(context).apply {
        nodeId = id
        applyEditable(true)
        applyMultiline(false)
        applyNumberOfLines(0)
        submitBehavior = "submit"
        blurOnSubmit = false
        layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
      }
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      (view as? RuneSecureTextInputView)?.let {
        it.manager = factory.manager
        it.nodeId = id
      }
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
      return RuneScrollView(context).apply {
        // bind happens after node creation so we can pass manager and id
      }
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      (view as? RuneScrollView)?.bind(factory.manager, id)
    }
  }

  private object ButtonCreator : ViewCreator {
    override fun create(context: android.content.Context, id: Int): View {
      return RuneButtonView(context).apply {
        nodeId = id
        background = GradientDrawable()
      }
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      val button = view as RuneButtonView
      button.listener = factory.manager
      val initialStyle = factory.deriveButtonVisualStyle(Style(), null, button)
      factory.buttonStyles.put(id, initialStyle)
      factory.applyVisualStyle(button, initialStyle)
    }
  }

  private object PressableCreator : ViewCreator {
    override fun create(context: android.content.Context, id: Int): View {
      return RunePressableView(context).apply {
        nodeId = id
      }
    }

    override fun registerHandlers(factory: RuneNodeFactory, id: Int, view: View, node: RuneUIManager.Node) {
      (view as? RunePressableView)?.listener = factory.manager
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
    NodeType.TEXT_INPUT -> TextInputCreator
    NodeType.SECURE_TEXT_INPUT -> SecureTextInputCreator
    NodeType.IMAGE -> ImageCreator
    NodeType.SCROLL_VIEW -> ScrollViewCreator
    NodeType.BUTTON -> ButtonCreator
    NodeType.PRESSABLE -> PressableCreator
    NodeType.OTHER -> OtherCreator
  }

  /**
   * Creates a new node of the specified type.
   * Handles view creation, initialization, and measurement handler setup for all component types:
   * TEXT, TEXT_INPUT, SECURE_TEXT_INPUT, IMAGE, SCROLL_VIEW, BUTTON, PRESSABLE.
   * 
   * Returns the newly created node's ID.
   */
  internal fun createNode(type: String): Int {
    val id = getNextId()
    incrementNextId()
    val view: View
    val label: TextView?

    // Fast dispatch once
    val nodeType = NodeType.fromString(type)
    val creator = getViewCreator(nodeType)
    view = creator.create(root.context, id)
    label = (view as? TextView)

    // Step 2: Apply appropriate layout params based on type
    when (type) {
      TEXT_TYPE -> {
        view.layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
      }
      TEXT_INPUT_TYPE, SECURE_TEXT_INPUT_TYPE -> {
        val params = view.layoutParams as? FrameLayout.LayoutParams
          ?: FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
          )
        params.width = FrameLayout.LayoutParams.WRAP_CONTENT
        params.height = FrameLayout.LayoutParams.WRAP_CONTENT
        view.layoutParams = params
        view.isClickable = true
        view.isFocusable = true
        view.isFocusableInTouchMode = true
      }
      BUTTON_TYPE, PRESSABLE_TYPE -> {
        val params = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        view.layoutParams = params
        view.isClickable = true
        view.isFocusable = true
        view.isFocusableInTouchMode = true
      }
      else -> {
        view.layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        view.isClickable = false
      }
    }
    view.setBackgroundColor(Color.TRANSPARENT)

    // Step 3: Create node and register
    val node = RuneUIManager.Node(id, type, view, label)
    node.cachedText = (label?.text?.toString() ?: "")
    if (type == IMAGE_TYPE) {
      imageSupport.initializeNode(node)
    }
    if (type == TEXT_INPUT_TYPE || type == SECURE_TEXT_INPUT_TYPE) {
      node.textInputState = RuneUIManager.TextInputState()
    }
    nodes.put(id, node)
    parents[id] = null
    engine.createNode(id)

    // Let the creator register any handlers or perform extra wiring
    creator.registerHandlers(this, id, view, node)

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
    } else if (type == TEXT_INPUT_TYPE || type == SECURE_TEXT_INPUT_TYPE) {
      val inputView = view as RuneTextInputView
      engine.setMeasureHandler(id) { input ->
        measureTextInput(inputView, input)
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
      parents.remove(id)
      return
    }

    // First, recursively remove all children
    val childrenToRemove = parents.entries.filter { it.value == id }.map { it.key }
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
    if (node.type == TEXT_INPUT_TYPE || node.type == SECURE_TEXT_INPUT_TYPE) {
      cleanupTextInput(node)
    }
    if (node.type == SCROLL_VIEW_TYPE) {
      (node.view as? RuneScrollView)?.unbind()
    }
    if (node.type == BUTTON_TYPE) {
      buttonStyles.remove(id)
    }

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
    parents.remove(id)
    node.parentId = null

    // Also clean up from any pending text rebuilds
    pendingTextRebuild.remove(id)
  }
}
