package com.rune.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.SparseArray
import android.view.Gravity
import android.view.View
import android.view.View.OnLayoutChangeListener
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RunePressableEventListener
import com.rune.kit.debug.PerformanceProfiler
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.MeasureHandler
import com.rune.kit.layout.MeasureInput
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Rect
import com.rune.kit.layout.Style
import com.rune.kit.layout.TransformOrigin
import com.rune.kit.layout.YogaLayoutEngine
import com.rune.kit.runtime.JSBridge
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import org.json.JSONArray
import java.util.HashMap
import java.util.LinkedHashSet
import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.roundToInt

private const val DEBUG_SCROLL_LAYOUT = false

internal enum class FlushPriority { HIGH, NORMAL }

internal sealed class ViewOperation {
  data class Insert(val parentId: Int, val childId: Int, val index: Int) : ViewOperation()
  data class Remove(val parentId: Int, val node: RuneUIManager.Node) : ViewOperation()
}

internal sealed class NativeOperation {
  /**
   * Optimized SetProp operation that stores:
   * - Raw JSON string for fallback compatibility
   * - Pre-parsed value to avoid repeated parsing
   * - Property category for fast dispatch
   */
  data class SetProp(
    val nodeId: Int,
    val name: String,
    val jsonValue: String?,
    val parsedValue: Any? = null,
    val category: PropertyCategory = PropertyCategory.UNKNOWN,
  ) : NativeOperation()
  
  data class SetText(val nodeId: Int, val text: String) : NativeOperation()
  data class SetHandler(val nodeId: Int, val event: String, val handlerId: Long) : NativeOperation()
}

class RuneUIManager(
  private val root: RuneRootView,
  private val eventDispatcher: (Int, String) -> Unit = { _, _ -> },
  private val handlerListener: (Int, String, Long) -> Unit = { _, _, _ -> },
) : JSBridge.UIShim, RunePressableEventListener {
  private val density: Float = root.resources.displayMetrics.density
  private fun isNativeDebugEnabled(): Boolean {
    return try {
      val debugValue = System.getProperty("__NATIVE_DEBUG__")
      debugValue?.toBoolean() ?: false
    } catch (e: Exception) {
      false
    }
  }

  private fun logDebug(tag: String, message: String) {
    if (!isNativeDebugEnabled()) return
    Log.d(tag, message)
  }

  fun registerSurface(surfaceId: Int, surfaceRoot: RuneRootView) = onMain {
    logSurfaceEvent(surfaceId, "registerSurface", "rootView=${surfaceRoot.hashCode()}")
    registerSurfaceInternal(surfaceId, surfaceRoot)
  }

  fun unregisterSurface(surfaceId: Int) = onMain {
    if (surfaceId == root.rootId) return@onMain
    val state = surfaces[surfaceId] ?: return@onMain
    
    Log.d("RuneUI", "Unregistering surface $surfaceId")
    state.trace("surface_unregistered", null)
    
    // Cancel pending flush
    state.layoutListener?.let { state.rootView.removeOnLayoutChangeListener(it) }
    state.frameScheduler.cancelFlush()

    // Remove all nodes in this surface
    val surfaceNodes = state.nodes
    val nodesToRemove = mutableListOf<Int>()
    for (i in 0 until surfaceNodes.size()) {
      val nodeId = surfaceNodes.keyAt(i)
      nodesToRemove.add(nodeId)
    }
    // NodeFactory intentionally keeps the surface root node; remove everything else.
    nodesToRemove.filter { it != surfaceId }.forEach { state.nodeFactory.removeNodeRecursive(it) }
    onNodeRemoved(surfaceId)

    // Clear pending operations
    state.pendingViewOperations.clear()
    state.pendingNativeOperations.clear()
    state.pendingTextRebuild.clear()
    state.stickyFrameCarryover.clear()
    state.firstFrameListeners.clear()
    state.frameCommitCoordinator.cancel()
    
    // Remove cached helpers
    propApplierCache.remove(surfaceId)
    eventManagerCache.remove(surfaceId)
    
    // Remove the Yoga root node for this surface
    state.engine.removeNode(surfaceId)
    
    // Remove surface state
    surfaces.remove(surfaceId)

    // Reset active surface if needed
    if (activeSurfaceId == surfaceId) {
      activeSurfaceId = root.rootId
    }
  }

  fun setActiveSurface(surfaceId: Int) = onMain {
    if (surfaces.containsKey(surfaceId)) {
      activeSurfaceId = surfaceId
      logSurfaceEvent(surfaceId, "setActiveSurface", "active=$surfaceId")
    } else {
      Log.w("RuneUI", "Ignoring setActiveSurface for unknown surfaceId=$surfaceId")
    }
  }
  data class Node(
    val id: Int,
    val type: String,
    val view: View,
    val label: TextView? = null,
    val textChildren: MutableList<Int> = mutableListOf(),
    // children holds the list of direct child node ids (lazy: null when no children)
    var children: MutableList<Int>? = null,
    var index: Int = -1,
    var parentId: Int? = null,
    var cachedText: String = "",
    var imageState: ImageState? = null,
    var pointerEvents: String = "auto",
    var textInputState: TextInputState? = null,
    var hasCompletedInitialMount: Boolean = false,
    // Cache for frame dimensions to detect changes and support sticky frame reuse
    var measuredFrame: Rect? = null,
    var hasOnLayoutHandler: Boolean = false,
    var lastLayoutX: Int = Int.MIN_VALUE,
    var lastLayoutY: Int = Int.MIN_VALUE,
    var lastLayoutWidth: Int = -1,
    var lastLayoutHeight: Int = -1,
    var layoutListener: OnLayoutChangeListener? = null,
    var surfaceId: Int = 0,
    var textStyle: TextStyleAttributes? = null,
    var layoutTransition: LayoutTransitionConfig? = null,
    var layoutAnimator: android.view.ViewPropertyAnimator? = null,
    var transformOrigin: TransformOrigin? = null,
    // Mount gating to prevent "unstyled first frame" when nodes are inserted before props land.
    var mountStartTimeMs: Long = 0L,
    var mountAwaitingFirstProps: Boolean = false,
    var mountHasVisualProps: Boolean = false,
  )

  data class SelectionSpec(var start: Int, var end: Int)

  data class TextInputState(
    var defaultValue: String = "",
    var currentText: String = "",
    var awaitingInitialValue: Boolean = true,
    var hasAppliedInitialText: Boolean = false,
    var pendingSelection: SelectionSpec? = null,
    var lastExactHeight: Int = 0,
  )

  private class SurfaceState(
    val id: Int,
    val rootView: RuneRootView,
    val engine: LayoutEngine,
    val nodes: SparseArray<Node>,
    val pendingTextRebuild: LinkedHashSet<Int>,
    val pendingViewOperations: MutableList<ViewOperation>,
    val pendingNativeOperations: MutableList<NativeOperation>,
    val stickyFrameCarryover: MutableSet<Int>,
    val frameScheduler: FrameScheduler,
    val layoutFlush: RuneLayoutFlush,
    val nodeFactory: RuneNodeFactory,
    val frameCommitCoordinator: FrameCommitCoordinator,
    val visualTracer: VisualStateTracer?,
    val firstFrameListeners: MutableList<() -> Unit>,
  ) {
    var lastWidth: Int = -1
    var lastHeight: Int = -1
    var layoutListener: OnLayoutChangeListener? = null
    var hasDispatchedFirstFrame: Boolean = false
  }

  private val handler = Handler(Looper.getMainLooper())
  private val eventPayloads = HashMap<String, ArrayDeque<String>>()
  private val nodeRecyclingPool = NodeRecyclingPool(
    debugLogging = isNativeDebugEnabled(),
  )
  private val recyclerHost = RuneRecyclerHost()
  private val surfaces = ConcurrentHashMap<Int, SurfaceState>()
  @Volatile private var activeSurfaceId: Int = root.rootId
  private var nextId = root.rootId + 1
  private val surfaceLogLimit = 200
  private val surfaceLogCounter = AtomicInteger(0)

  private val currentSurface: SurfaceState
    get() = surfaceStateOrNull(activeSurfaceId)
      ?: throw IllegalStateException("Surface $activeSurfaceId not registered")

  // Per-surface accessors - these delegate to the current active surface
  private val engine get() = currentSurface.engine
  private val nodes get() = currentSurface.nodes
  private val pendingTextRebuild get() = currentSurface.pendingTextRebuild
  private val pendingViewOperations get() = currentSurface.pendingViewOperations
  private val pendingNativeOperations get() = currentSurface.pendingNativeOperations
  private val stickyFrameCarryover get() = currentSurface.stickyFrameCarryover
  private val frameScheduler get() = currentSurface.frameScheduler
  private val layoutFlush get() = currentSurface.layoutFlush
  private val nodeFactory get() = currentSurface.nodeFactory
  private val surfaceMetrics = ConcurrentHashMap<Int, RuneLayoutFlush.FlushMetrics>()
  
  // These are created lazily per-surface and cached
  private val propApplierCache = ConcurrentHashMap<Int, RunePropApplier>()
  private val eventManagerCache = ConcurrentHashMap<Int, RuneEventManager>()
  private val frameBarrierScope: String? by lazy { System.getProperty("rune.frameBarrier.scope")?.lowercase() }
  private val nodeToSurfaceId = ConcurrentHashMap<Int, Int>()

  private fun surfaceStateOrNull(id: Int): SurfaceState? = surfaces[id]

  private fun surfaceState(id: Int): SurfaceState =
    surfaceStateOrNull(id) ?: throw IllegalStateException("Surface $id not registered")

  private fun logSurfaceEvent(surfaceId: Int, event: String, details: String? = null) {
    // if (!isNativeDebugEnabled()) return
    val index = surfaceLogCounter.getAndIncrement()
    if (index >= surfaceLogLimit) return
    val suffix = when {
      details.isNullOrBlank() -> ""
      else -> " $details"
    }
    Log.d("RuneSurface", "[surface=$surfaceId] $event$suffix")
  }

  fun addSurfaceFirstFrameListener(surfaceId: Int, listener: () -> Unit) = onMain {
    val state = surfaceState(surfaceId)
    if (state.hasDispatchedFirstFrame) {
      listener()
    } else {
      state.firstFrameListeners.add(listener)
    }
  }

  fun removeSurfaceFirstFrameListener(surfaceId: Int, listener: () -> Unit) = onMain {
    surfaceStateOrNull(surfaceId)?.firstFrameListeners?.remove(listener)
  }

  fun isSurfaceIdle(surfaceId: Int): Boolean {
    val state = surfaceStateOrNull(surfaceId) ?: return true
    return state.frameScheduler.isIdle
  }

  private fun dispatchSurfaceFirstFrame(surfaceId: Int) {
    val state = surfaceStateOrNull(surfaceId) ?: return
    if (state.hasDispatchedFirstFrame) return
    state.hasDispatchedFirstFrame = true
    // Reveal surface content only after the first "usable" flush.
    if (state.rootView.contentView.visibility != View.VISIBLE) {
      state.rootView.contentView.visibility = View.VISIBLE
    }
    if (state.firstFrameListeners.isEmpty()) return
    val callbacks = state.firstFrameListeners.toList()
    state.firstFrameListeners.clear()
    callbacks.forEach { callback ->
      runCatching { callback() }.onFailure {
        Log.w("RuneUI", "Surface $surfaceId first-frame callback failed", it)
      }
    }
  }

  private fun registerSurfaceInternal(surfaceId: Int, surfaceRoot: RuneRootView) {
    if (surfaces.containsKey(surfaceId)) return

    // Ensure node ids never collide with the surface root id.
    if (nextId <= surfaceId) {
      nextId = surfaceId + 1
    }

    Log.d("RuneUI", "Registering surface $surfaceId")
    
    // Create a NEW isolated YogaLayoutEngine for this surface
    // Each surface gets its own Yoga tree to prevent node collisions
    val surfaceEngine = YogaLayoutEngine(rootId = surfaceId)
    Log.d("RuneUI", "Created isolated Yoga engine for surface $surfaceId")
    
    // Initialize Yoga root node for this surface
    // Configure it as a flex container that can hold children
    surfaceEngine.createNode(surfaceId)
    // CRITICAL: Ensure the root node has NO measure function
    surfaceEngine.setMeasureHandler(surfaceId, null)
    surfaceEngine.setStyle(surfaceId, Style(
      flexDirection = "column",
      alignItems = "stretch",  // Children stretch to full width (standard CSS Flexbox default)
    ))
    Log.d("RuneUI", "Surface $surfaceId Yoga node configured as flex container (no measure function)")
    
    // Create per-surface node storage
    val surfaceNodes = SparseArray<Node>()
    
    // Create a virtual container node for the surface root
    // This represents the RuneRootView's content container and allows children to be inserted
    val rootContainerNode = Node(
      id = surfaceId,
      type = "view",
      view = surfaceRoot.contentView,
      label = null,
      surfaceId = surfaceId,
    )
    rootContainerNode.mountAwaitingFirstProps = false
    rootContainerNode.mountHasVisualProps = true
    surfaceNodes.put(surfaceId, rootContainerNode)
    onNodeCreated(surfaceId, surfaceId)
    Log.d("RuneUI", "Created virtual root container node for surface $surfaceId")
    // Default to hidden until we get a first-frame callback for this surface.
    surfaceRoot.contentView.visibility = View.INVISIBLE
    val pendingTextRebuild = LinkedHashSet<Int>()
    val pendingViewOperations = mutableListOf<ViewOperation>()
    val pendingNativeOperations = mutableListOf<NativeOperation>()
    val stickyFrameCarryover = mutableSetOf<Int>()
    val frameScheduler = FrameScheduler()
    val visualTracer = if (VisualStateTracer.isEnabled()) VisualStateTracer(surfaceId) else null
    visualTracer?.trace("surface_registered", "rootView=${surfaceRoot.hashCode()}")
    val frameCommitCoordinator = FrameCommitCoordinator(surfaceRoot, surfaceId, ::logDebug, visualTracer)
    lateinit var layoutFlush: RuneLayoutFlush

    val nodeFactory = RuneNodeFactory(
      root = surfaceRoot,
      nodes = surfaceNodes,
      engine = surfaceEngine,
      pendingTextRebuild = pendingTextRebuild,
      nodeRecyclingPool = nodeRecyclingPool,
      getNextId = { nextId },
      incrementNextId = { nextId++ },
      scheduleFlush = { priority: FlushPriority -> layoutFlush.scheduleFlush(priority) },
      logDebug = ::logDebug,
      manager = this,
      surfaceId = surfaceId,
    )

    val eventManager = RuneEventManager(
      nodes = surfaceNodes,
      engine = surfaceEngine,
      eventDispatcher = eventDispatcher,
      handlerListener = handlerListener,
      eventPayloads = eventPayloads,
    )
    eventManagerCache[surfaceId] = eventManager

    val propApplier = RunePropApplier(
      nodes = surfaceNodes,
      engine = surfaceEngine,
      density = density,
      logDebug = ::logDebug,
      resolveTextNode = { id -> nodeFactory.resolveTextNode(id) },
      onTextInputTextUpdated = { _, _ -> },
      storeEventPayload = { nodeId, event, payload -> eventManager.storeEventPayload(nodeId, event, payload) },
    )
    propApplierCache[surfaceId] = propApplier

    layoutFlush = RuneLayoutFlush(
      root = surfaceRoot,
      nodes = surfaceNodes,
      engine = surfaceEngine,
      handler = handler,
      frameScheduler = frameScheduler,
      pendingNativeOperations = pendingNativeOperations,
      pendingViewOperations = pendingViewOperations,
      pendingTextRebuild = pendingTextRebuild,
      stickyFrameCarryover = stickyFrameCarryover,
      isVirtualTextNode = { node -> nodeFactory.isVirtualTextNode(node) },
      removeNodeRecursive = { nodeId -> nodeFactory.removeNodeRecursive(nodeId, detachView = false) },
      applySetProp = { nodeId, name, jsonValue, category ->
        val startNs = SystemClock.elapsedRealtimeNanos()
        propApplier.applySetProp(nodeId, name, jsonValue, category)
        maybeLogSlowNativeWork(nodeId, name, category.name, startNs)
      },
      applySetText = { nodeId, text ->
        val startNs = SystemClock.elapsedRealtimeNanos()
        propApplier.applySetText(nodeId, text) { node -> nodeFactory.propagateTextChange(node) }
        maybeLogSlowNativeWork(nodeId, "setText", "text", startNs)
      },
      applySetHandler = { nodeId, event, handlerId ->
        propApplier.applySetHandler(nodeId, event, eventDispatcher, handlerListener, handlerId)
      },
      logDebug = ::logDebug,
      isNativeDebugEnabled = ::isNativeDebugEnabled,
      surfaceId = surfaceId,
      frameCommitCoordinator = frameCommitCoordinator,
      visualTracer = visualTracer,
      reportMetrics = ::recordSurfaceMetrics,
    )
    layoutFlush.setOnFirstFrameCallback { dispatchSurfaceFirstFrame(surfaceId) }

    val surfaceState = SurfaceState(
      id = surfaceId,
      rootView = surfaceRoot,
      engine = surfaceEngine,
      nodes = surfaceNodes,
      pendingTextRebuild = pendingTextRebuild,
      pendingViewOperations = pendingViewOperations,
      pendingNativeOperations = pendingNativeOperations,
      stickyFrameCarryover = stickyFrameCarryover,
      frameScheduler = frameScheduler,
      layoutFlush = layoutFlush,
      nodeFactory = nodeFactory,
      frameCommitCoordinator = frameCommitCoordinator,
      visualTracer = visualTracer,
      firstFrameListeners = mutableListOf(),
    )
    surfaceState.trace("surface_ready", "width=${surfaceRoot.width} height=${surfaceRoot.height}")

    val listener = OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      val width = surfaceRoot.width
      val height = surfaceRoot.height
      if (width != surfaceState.lastWidth || height != surfaceState.lastHeight) {
        surfaceState.lastWidth = width
        surfaceState.lastHeight = height
        surfaceState.layoutFlush.scheduleFlush()
      }
    }
    surfaceState.layoutListener = listener
    surfaceRoot.addOnLayoutChangeListener(listener)
    surfaceState.lastWidth = surfaceRoot.width
    surfaceState.lastHeight = surfaceRoot.height

    surfaces[surfaceId] = surfaceState
  }

  init {
    RuneComponentRegistry.ensureInitialized()
    registerSurfaceInternal(root.rootId, root)
  }

  internal fun onNodeCreated(nodeId: Int, surfaceId: Int) {
    nodeToSurfaceId[nodeId] = surfaceId
  }

  internal fun onNodeRemoved(nodeId: Int) {
    nodeToSurfaceId.remove(nodeId)
  }

  private fun surfaceStateForNode(nodeId: Int): SurfaceState {
    val mapped = nodeToSurfaceId[nodeId]
    if (mapped != null) {
      return surfaceStateOrNull(mapped) ?: currentSurface
    }
    // Fallback: search all surfaces (should be rare).
    val found = surfaces.values.firstOrNull { it.nodes.get(nodeId) != null }
    if (found != null) {
      nodeToSurfaceId[nodeId] = found.id
      return found
    }
    return currentSurface
  }

  private fun surfaceStateForParent(parentId: Int): SurfaceState {
    surfaces[parentId]?.let { return it }
    val mapped = nodeToSurfaceId[parentId]
    if (mapped != null) {
      return surfaceStateOrNull(mapped) ?: currentSurface
    }
    val found = surfaces.values.firstOrNull { it.nodes.get(parentId) != null }
    if (found != null) {
      nodeToSurfaceId[parentId] = found.id
      return found
    }
    return currentSurface
  }

  // Public accessor methods for component packages
  fun getRootView(): RuneRootView = surfaceStateOrNull(activeSurfaceId)?.rootView ?: root
  fun getLayoutEngine(): LayoutEngine = engine
  fun getNodeView(nodeId: Int): View? {
    val surface = surfaceStateForNode(nodeId)
    return surface.nodes.get(nodeId)?.view
  }
  internal fun getAppliedStyleForNode(nodeId: Int): Style? {
    val surface = surfaceStateForNode(nodeId)
    return propApplierCache[surface.id]?.getAppliedStyle(nodeId)
  }

  fun applyKeyboardAvoidingAdjustment(
    nodeId: Int,
    behavior: String,
    overlapPx: Float,
  ) = onMain {
    val surface = surfaceStateForNode(nodeId)
    val node = surface.nodes.get(nodeId) ?: return@onMain
    val baseStyle = getAppliedStyleForNode(nodeId) ?: Style()
    val resolvedOverlap = overlapPx.coerceAtLeast(0f)

    val updatedStyle = when (behavior.lowercase()) {
      "padding" -> {
        val basePadding = resolvePaddingBottom(baseStyle)
        baseStyle.copy(paddingBottom = basePadding + resolvedOverlap)
      }
      "height" -> {
        if (resolvedOverlap <= 0f) {
          baseStyle
        } else {
          val targetHeight = (node.view.height - resolvedOverlap).coerceAtLeast(0f)
          baseStyle.copy(height = targetHeight, heightPercent = null, heightAuto = false)
        }
      }
      else -> baseStyle
    }

    surface.engine.setStyle(nodeId, updatedStyle)
    if (behavior.lowercase() == "padding" || behavior.lowercase() == "height") {
      applyKeyboardAvoidingLayout(surface, nodeId, behavior, resolvedOverlap)
    }
  }
  
  private fun getEventManagerForNode(nodeId: Int): RuneEventManager {
    val surfaceId = surfaceStateForNode(nodeId).id
    return eventManagerCache[surfaceId]
      ?: throw IllegalStateException("EventManager not found for surface $surfaceId")
  }
  
  // Performance tracking for operation queues
  private var maxViewOps = 0
  private var maxNativeOps = 0
  private var scheduleFlushCount = 0
  private var totalNodesCreated = 0
  private var totalNodesRemoved = 0

  // Child management helpers: lazily allocate children list on first attach
  private fun attachChild(surface: SurfaceState, parentId: Int, childId: Int, atIndex: Int = -1) {
    val surfaceNodes = surface.nodes
    val parentNode = surfaceNodes.get(parentId)
    val childNode = surfaceNodes.get(childId)
    // still allow attaching even if node isn't created yet; parentId is set on child when created
    if (parentNode == null || childNode == null) {
      // fallback to setting parentId on the child Node if it exists
      surfaceNodes.get(childId)?.parentId = parentId
      return
    }

    if (parentNode.children == null) parentNode.children = ArrayList()
    val list = parentNode.children!!
    var insertPos = if (atIndex < 0 || atIndex > list.size) list.size else atIndex
    // remove existing occurrence (defensive) and adjust index if needed
    val existingIndex = list.indexOf(childId)
    if (existingIndex >= 0) {
      list.removeAt(existingIndex)
      if (existingIndex < insertPos) {
        insertPos = (insertPos - 1).coerceAtLeast(0)
      }
    }
    if (insertPos > list.size) insertPos = list.size
    list.add(insertPos, childId)

    childNode.parentId = parentId
    childNode.index = insertPos

    // update indices of following siblings
    for (i in insertPos + 1 until list.size) {
      surfaceNodes.get(list[i])?.index = i
    }
  }

  private fun detachChild(surface: SurfaceState, parentId: Int, childId: Int) {
    val surfaceNodes = surface.nodes
    val parentNode = surfaceNodes.get(parentId) ?: return
    val list = parentNode.children ?: return
    val idx = list.indexOf(childId)
    if (idx >= 0) {
      list.removeAt(idx)
      for (i in idx until list.size) {
        surfaceNodes.get(list[i])?.index = i
      }
      surfaceNodes.get(childId)?.parentId = null
      surfaceNodes.get(childId)?.index = -1
      if (list.isEmpty()) parentNode.children = null
    }
  }

  private fun applyKeyboardAvoidingLayout(
    surface: SurfaceState,
    rootNodeId: Int,
    behavior: String,
    overlapPx: Float,
  ) {
    val rootNode = surface.nodes.get(rootNodeId) ?: return
    val width = rootNode.view.width
    val height = rootNode.view.height
    if (width <= 0 || height <= 0) return

    val targetHeight = if (behavior.lowercase() == "height" && overlapPx > 0f) {
      (height - overlapPx).coerceAtLeast(0f)
    } else {
      height.toFloat()
    }

    surface.engine.calculateLayoutForNode(rootNodeId, width.toFloat(), targetHeight)

    val queue = ArrayDeque<Int>()
    queue.add(rootNodeId)
    while (queue.isNotEmpty()) {
      val nodeId = queue.removeFirst()
      val node = surface.nodes.get(nodeId) ?: continue
      if (surface.nodeFactory.isVirtualTextNode(node)) continue

      if (nodeId == rootNodeId && behavior.lowercase() != "height") {
        node.children?.forEach { childId -> queue.add(childId) }
        continue
      }

      val frame = surface.engine.frame(nodeId)
      val keepPosition = nodeId == rootNodeId
      applyKeyboardAvoidingFrame(node, frame, keepPosition)
      node.children?.forEach { childId -> queue.add(childId) }
    }
  }

  private fun applyKeyboardAvoidingFrame(
    node: Node,
    frame: Rect,
    keepPosition: Boolean,
  ) {
    val width = (frame.right - frame.left).coerceAtLeast(0)
    val height = (frame.bottom - frame.top).coerceAtLeast(0)
    val left = if (keepPosition) node.view.left else frame.left
    val top = if (keepPosition) node.view.top else frame.top
    val right = left + width
    val bottom = top + height

    val layoutParams = when (val current = node.view.layoutParams) {
      is android.widget.FrameLayout.LayoutParams -> current
      else -> android.widget.FrameLayout.LayoutParams(width, height)
    }

    var paramsChanged = false
    if (layoutParams.width != width) {
      layoutParams.width = width
      paramsChanged = true
    }
    if (layoutParams.height != height) {
      layoutParams.height = height
      paramsChanged = true
    }
    if (layoutParams.leftMargin != left) {
      layoutParams.leftMargin = left
      paramsChanged = true
    }
    if (layoutParams.topMargin != top) {
      layoutParams.topMargin = top
      paramsChanged = true
    }
    if (layoutParams.gravity != (android.view.Gravity.START or android.view.Gravity.TOP)) {
      layoutParams.gravity = android.view.Gravity.START or android.view.Gravity.TOP
      paramsChanged = true
    }
    if (paramsChanged) {
      node.view.layoutParams = layoutParams
    }

    val cachedFrame = node.measuredFrame
    val frameChanged = cachedFrame == null ||
      cachedFrame.left != left ||
      cachedFrame.top != top ||
      cachedFrame.right != right ||
      cachedFrame.bottom != bottom

    if (frameChanged) {
      val targetWidthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY)
      val targetHeightSpec = View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
      if (node.view.measuredWidth != width || node.view.measuredHeight != height) {
        node.view.measure(targetWidthSpec, targetHeightSpec)
      }
      node.measuredFrame = Rect(left, top, right, bottom)
    }

    node.view.layout(left, top, right, bottom)
    if (node.type != TEXT_TYPE) {
      node.label?.layout(0, 0, width, height)
    }
  }

  private fun resolvePaddingBottom(style: Style): Float {
    return style.paddingBottom
      ?: style.paddingVertical
      ?: style.padding
      ?: 0f
  }

  fun consumeEventPayload(nodeId: Int, event: String): JSONObject? {
    return getEventManagerForNode(nodeId).consumeEventPayload(nodeId, event)
  }

  fun dequeueEventPayloadJson(nodeId: Int, event: String): String? {
    return getEventManagerForNode(nodeId).dequeueEventPayloadJson(nodeId, event)
  }

  override fun createNode(type: String): Int = onMain {
    val surface = currentSurface
    val surfaceId = surface.id
    // RECYCLING DISABLED - causing bugs without fixing performance
    // The real issue is elsewhere (scroll offset updates, layout calculations)
    
    val createStart = android.os.SystemClock.elapsedRealtime()
    
    // Create new node from scratch
    val id = nodeFactory.createNode(type)
    surface.trace("create_node") { "id=$id type=$type" }
    logSurfaceEvent(surfaceId, "createNode", "id=$id type=$type")
    
    totalNodesCreated++
    
    val createTime = android.os.SystemClock.elapsedRealtime() - createStart
    if (createTime > 10) {
      // Log.w("RunePerf", "⚠️ createNode took ${createTime}ms for type=$type (id=$id)")
    }
    
    // Warn if node count is growing too large
    if (nodes.size() > 400 && totalNodesCreated % 50 == 0) {
      // Log.e("RunePerf", "🚨 Node count: ${nodes.size()} (created: $totalNodesCreated, removed: $totalNodesRemoved, leaked: ${totalNodesCreated - totalNodesRemoved - nodes.size()})")
    }
    
    return@onMain id
  }

  private fun parseString(json: String?): String? {
    if (json == null || json == "null") return null
    // The string is JSON-encoded, so it's wrapped in quotes.
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

  private fun applyBackgroundStyle(view: View, style: Style) {
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
      when (view.background) {
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

  fun dispatchEvent(nodeId: Int, event: String, payload: JSONObject?) {
    getEventManagerForNode(nodeId).dispatchEvent(nodeId, event, payload)
  }

  /**
   * Allow components to provide custom Yoga measurement for their nodes.
   */
  fun setMeasureHandler(nodeId: Int, handler: MeasureHandler?) {
    val surface = surfaceStateForNode(nodeId)
    surface.engine.setMeasureHandler(nodeId, handler)
    if (handler != null) {
      markNodeDirty(nodeId)
    }
  }

  /**
   * Generic API to mark a node's layout as dirty and trigger relayout.
   * Used by components when their intrinsic size changes.
   * Note: TEXT nodes with measure functions cannot be marked dirty directly.
   */
  fun markNodeDirty(nodeId: Int) {
    val surface = surfaceStateForNode(nodeId)
    // Always mark dirty, even for text nodes, to force remeasurement
    surface.engine.markDirty(nodeId)
    
    scheduleFlush(FlushPriority.HIGH, surface)
  }

  override fun onPressablePressIn(nodeId: Int, payload: JSONObject) {
    getEventManagerForNode(nodeId).onPressablePressIn(nodeId, payload)
  }

  override fun onPressablePressOut(nodeId: Int, payload: JSONObject, cancelled: Boolean) {
    getEventManagerForNode(nodeId).onPressablePressOut(nodeId, payload, cancelled)
  }

  override fun onPressablePress(nodeId: Int, payload: JSONObject) {
    getEventManagerForNode(nodeId).onPressablePress(nodeId, payload)
  }

  override fun onPressableLongPress(nodeId: Int, durationMs: Long, payload: JSONObject) {
    getEventManagerForNode(nodeId).onPressableLongPress(nodeId, durationMs, payload)
  }

  override fun onPressableDoublePress(nodeId: Int, payload: JSONObject) {
    getEventManagerForNode(nodeId).onPressableDoublePress(nodeId, payload)
  }

  override fun onPressableHover(nodeId: Int, hovering: Boolean) {
    getEventManagerForNode(nodeId).onPressableHover(nodeId, hovering)
  }

  override fun onPressableFocus(nodeId: Int) {
    getEventManagerForNode(nodeId).onPressableFocus(nodeId)
  }

  override fun onPressableBlur(nodeId: Int) {
    getEventManagerForNode(nodeId).onPressableBlur(nodeId)
  }

  override fun onPressableKeyEvent(nodeId: Int, phase: String, payload: JSONObject) {
    getEventManagerForNode(nodeId).onPressableKeyEvent(nodeId, phase, payload)
  }

  override fun onPressableCancel(nodeId: Int, payload: JSONObject) {
    getEventManagerForNode(nodeId).onPressableCancel(nodeId, payload)
  }

  override fun applyBatch(batchJson: String) = onMain {
    if (batchJson.isBlank()) return@onMain
    // Log.d("RuneNative", "applyBatch: $batchJson")
    val payload = runCatching { JSONObject(batchJson) }.getOrNull() ?: return@onMain
    val operations = payload.optJSONArray("operations") ?: return@onMain
    
    Log.d("RuneNative", "applyBatch processing ${operations.length()} ops")

    recyclerHost.onBatch(payload.optJSONObject("meta"), operations)

    for (i in 0 until operations.length()) {
      val op = operations.optJSONObject(i) ?: continue
      when (op.optString("type")) {
        "createNode" -> {
          val nodeId = op.optInt("nodeId", -1)
          val tag = op.optString("tag")
          if (nodeId >= 0 && tag.isNotEmpty()) {
            nodeFactory.createNode(tag, nodeId)
            totalNodesCreated++
          }
        }
        "insertChild" -> {
          val parentId = op.optInt("parentId", -1)
          val childId = op.optInt("childId", -1)
          val index = op.optInt("index", -1)
          if (parentId >= 0 && childId >= 0) {
            insertChild(parentId, childId, index)
          }
        }
        "removeChild" -> {
          val parentId = op.optInt("parentId", -1)
          val childId = op.optInt("childId", -1)
          if (parentId >= 0 && childId >= 0) {
            removeChild(parentId, childId)
          }
        }
        "setProp" -> {
          val nodeId = op.optInt("nodeId", -1)
          if (nodeId < 0) continue
          val name = op.optString("name")
          if (name.isBlank()) continue
          val value = op.opt("value")
          val jsonValue = encodeBatchValue(value)
          setProp(nodeId, name, jsonValue)
        }
        "setText" -> {
          val nodeId = op.optInt("nodeId", -1)
          if (nodeId < 0) continue
          val value = op.opt("value")
          val text = when (value) {
            null, JSONObject.NULL -> ""
            else -> value.toString()
          }
          setText(nodeId, text)
        }
      }
    }
  }

  /**
   * Apply animated style properties directly to a view, bypassing the batching system.
   * This is called from native animations (via JNI) for immediate visual feedback.
   * Must be called on the main thread for immediate application.
   */
  override fun applyAnimatedStyle(
    nodeId: Int,
    opacity: Float,
    translateX: Float,
    translateY: Float,
    scaleX: Float,
    scaleY: Float,
    rotate: Float,
    rotateX: Float,
    rotateY: Float,
    skewX: Float,
    skewY: Float,
    perspective: Float,
  ) {
    // Run on main thread for immediate view updates
    if (Looper.myLooper() != Looper.getMainLooper()) {
      handler.post {
        applyAnimatedStyleInternal(
          nodeId,
          opacity,
          translateX,
          translateY,
          scaleX,
          scaleY,
          rotate,
          rotateX,
          rotateY,
          skewX,
          skewY,
          perspective,
        )
      }
    } else {
      applyAnimatedStyleInternal(
        nodeId,
        opacity,
        translateX,
        translateY,
        scaleX,
        scaleY,
        rotate,
        rotateX,
        rotateY,
        skewX,
        skewY,
        perspective,
      )
    }
  }

  private fun applyAnimatedStyleInternal(
    nodeId: Int,
    opacity: Float,
    translateX: Float,
    translateY: Float,
    scaleX: Float,
    scaleY: Float,
    rotate: Float,
    rotateX: Float,
    rotateY: Float,
    skewX: Float,
    skewY: Float,
    perspective: Float,
  ) {
    val view = getNodeView(nodeId) ?: return
    view.alpha = opacity
    view.translationX = translateX * density
    view.translationY = translateY * density
    view.scaleX = scaleX
    view.scaleY = scaleY
    view.rotation = rotate
    view.rotationX = -rotateX
    view.rotationY = -rotateY
    val has3dRotation = kotlin.math.abs(rotateX) > 0.001f || kotlin.math.abs(rotateY) > 0.001f
    if (!perspective.isNaN() && perspective > 0f) {
      view.cameraDistance = perspective * density * PERSPECTIVE_SCALE
    } else if (has3dRotation) {
      // Align default 3D perspective with iOS/CSS when not explicitly provided.
      view.cameraDistance = DEFAULT_PERSPECTIVE * density * PERSPECTIVE_SCALE
    }
    val hasSkew = kotlin.math.abs(skewX) > 0.001f || kotlin.math.abs(skewY) > 0.001f
    if (hasSkew) {
      val matrix = android.graphics.Matrix()
      val radX = Math.toRadians(skewX.toDouble()).toFloat()
      val radY = Math.toRadians(skewY.toDouble()).toFloat()
      
      // Pivot logic to match View rotation/scale behavior
      val px = view.pivotX
      val py = view.pivotY
      matrix.setTranslate(-px, -py)
      
      val skew = android.graphics.Matrix()
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
      view.setAnimationMatrix(matrix)
    } else {
      view.setAnimationMatrix(null)
      view.setLayerType(View.LAYER_TYPE_NONE, null)
    }
  }

  private fun encodeBatchValue(value: Any?): String? {
    when (value) {
      null, JSONObject.NULL -> return null
      is JSONObject -> return value.toString()
      is JSONArray -> return value.toString()
      is Number, is Boolean, is String -> {
        val wrapped = JSONObject.wrap(value)
        return wrapped?.toString() ?: value.toString()
      }
      else -> {
        val wrapped = JSONObject.wrap(value)
        return wrapped?.toString()
      }
    }
  }

  private fun maybeLogSlowNativeWork(
    nodeId: Int,
    label: String,
    category: String,
    startedAtNs: Long,
  ) {
    val elapsedMs = (SystemClock.elapsedRealtimeNanos() - startedAtNs) / 1_000_000.0
    if (elapsedMs < 4.0) return
    val surfaceId = runCatching { surfaceStateForNode(nodeId).id }.getOrElse { activeSurfaceId }
    val message = String.format(
      Locale.US,
      "slow native op: surface=%d node=%d op=%s category=%s duration=%.2fms",
      surfaceId,
      nodeId,
      label,
      category,
      elapsedMs,
    )
    Log.w("RunePerf", message)
  }

  override fun setProp(nodeId: Int, name: String, jsonValue: String?) = onMain {
    val surface = surfaceStateForNode(nodeId)
    logSurfaceEvent(surface.id, "setProp", "node=$nodeId name=$name")
    surface.trace("setProp") {
      val formatted = surface.visualTracer?.formatJson(jsonValue) ?: "null"
      "node=$nodeId $name=$formatted"
    }
    val targetNode = surface.nodes.get(nodeId)
    // Any visual prop marks the node as "ready" to be shown if it was inserted before props arrived.
    targetNode?.mountHasVisualProps = true
    if (name == "style" && targetNode?.type == TEXT_TYPE) {
      surface.nodeFactory.propagateTextChange(targetNode)
    }
    val queue = surface.pendingNativeOperations
    // Fast O(1) property categorization for optimized dispatch
    val category = PropertyCategoryMap.getCategory(name)
    
    // Optionally pre-parse value for certain categories (future optimization)
    // For now, we defer parsing until application
    val parsedValue: Any? = null
    
    // Deduplicate: remove any previous setProp for same node+property
    // Use reversed iteration for better performance when removing from end
    val iterator = queue.listIterator(queue.size)
    var removedCount = 0
    while (iterator.hasPrevious() && removedCount < 20) {
      val op = iterator.previous()
      if (op is NativeOperation.SetProp && op.nodeId == nodeId && op.name == name) {
        iterator.remove()
        break // Only one setProp per node+property needed
      }
      removedCount++
    }
    
    queue.add(
      NativeOperation.SetProp(
        nodeId = nodeId,
        name = name,
        jsonValue = jsonValue,
        parsedValue = parsedValue,
        category = category
      )
    )
    scheduleFlush(surface = surface)
  }

  override fun setText(nodeId: Int, text: String) = onMain {
    val surface = surfaceStateForNode(nodeId)
    logSurfaceEvent(surface.id, "setText", "node=$nodeId length=${text.length}")
    surface.trace("setText") { "node=$nodeId len=${text.length}" }
    surface.nodes.get(nodeId)?.let { node ->
      node.mountHasVisualProps = true
      surface.nodeFactory.propagateTextChange(node)
    }
    val queue = surface.pendingNativeOperations
    // Deduplicate: remove any previous setText for same node
    // Use reversed iteration for better performance when removing from end
    val iterator = queue.listIterator(queue.size)
    var removedCount = 0
    while (iterator.hasPrevious() && removedCount < 10) {
      val op = iterator.previous()
      if (op is NativeOperation.SetText && op.nodeId == nodeId) {
        iterator.remove()
        break // Only one setText per node needed
      }
      removedCount++
    }
    
    queue.add(NativeOperation.SetText(nodeId, text))
    scheduleFlush(surface = surface)
  }

  override fun insertChild(parentId: Int, childId: Int, index: Int) = onMain {
    val surface = surfaceStateForParent(parentId)
    logSurfaceEvent(surface.id, "insertChild", "parent=$parentId child=$childId index=$index")
    surface.trace("insertChild") { "parent=$parentId child=$childId index=$index" }
    
    // Get nodes from the correct surface
    val surfaceNodes = surface.nodes
    val childNode = surfaceNodes.get(childId)
    val parentNode = surfaceNodes.get(parentId)
    
    attachChild(surface, parentId, childId, index)
    
    if (parentNode?.type == TEXT_TYPE) {
      // If parent is a text node, merge text content from child instead of nesting views
      if (childNode?.type == TEXT_TYPE) {
        // CRITICAL: Remove measure function from virtual text node
        // Virtual text nodes should not have measure functions since they're merged into parent
        surface.engine.setMeasureHandler(childId, null)
        
        val insertIndex = index.coerceIn(0, parentNode.textChildren.size)
        parentNode.textChildren.remove(childId)
        parentNode.textChildren.add(insertIndex, childId)
        surface.nodeFactory.propagateTextChange(parentNode)
      }
      scheduleFlush(surface = surface)
      return@onMain
    }
    
    if (childNode == null) {
      Log.w("RuneUI", "insertChild: node $childId not found for parent $parentId")
      return@onMain
    }
    val queue = surface.pendingViewOperations
    queue.removeAll { op ->
      op is ViewOperation.Remove && op.node.id == childId
    }
    queue.add(ViewOperation.Insert(parentId, childId, index))
    surface.engine.insertChild(parentId, childId, index)
    scheduleFlush(surface = surface)
  }

  override fun removeChild(parentId: Int, childId: Int) = onMain {
    val surface = surfaceStateForParent(parentId)
    // Track removal frequency
    if (totalNodesRemoved % 10 == 0 && totalNodesRemoved > 0) {
      // Log.i("RunePerf", "🗑️ removeChild called (total removed: $totalNodesRemoved, current nodes: ${nodes.size()})")
    }
    
    val parentNode = surface.nodes.get(parentId)
    surface.trace("removeChild") { "parent=$parentId child=$childId parentType=${parentNode?.type}" }
    if (parentNode?.type == TEXT_TYPE) {
      parentNode.textChildren.remove(childId)
      detachChild(surface, parentId, childId)
      surface.pendingTextRebuild.add(parentNode.id)
      // We MUST mark dirty so Yoga invalidates the cached size and calls measure() again.
      surface.engine.markDirty(parentNode.id)
      surface.nodeFactory.propagateTextChange(parentNode)
      scheduleFlush(surface = surface)
      return@onMain
    }

    val childNode = surface.nodes.get(childId)
    if (childNode == null) {
      Log.w("RuneUI", "removeChild: node $childId not found for parent $parentId")
      return@onMain
    }
    
    totalNodesRemoved++
    detachChild(surface, parentId, childId)
    
    val queue = surface.pendingViewOperations
    queue.removeAll { op ->
      op is ViewOperation.Insert && op.parentId == parentId && op.childId == childId
    }
    
    // Defer node destruction to flush-time, otherwise native operations queued in the same
    // transaction (e.g., setText) can observe a missing node.
    queue.add(ViewOperation.Remove(parentId, childNode))
    scheduleFlush(surface = surface)
  }

  override fun setHandler(nodeId: Int, event: String, handlerId: Long) = onMain {
    val surface = surfaceStateForNode(nodeId)
    surface.trace("setHandler") { "node=$nodeId event=$event handler=$handlerId" }
    surface.pendingNativeOperations.add(NativeOperation.SetHandler(nodeId, event, handlerId))
    scheduleFlush(surface = surface)
  }

  override fun removeNode(nodeId: Int) = onMain {
    val surface = surfaceStateForNode(nodeId)
    surface.trace("removeNode") { "node=$nodeId" }
    surface.nodeFactory.removeNodeRecursive(nodeId)
    scheduleFlush(surface = surface)
  }

  override fun setSurface(surfaceId: Int) {
    onMain { setActiveSurface(surfaceId) }
  }

  fun hasRenderableContent(): Boolean = onMain { nodes.size() > 0 }

  fun clearAllNodes() = onMain {
    logDebug("RuneUI", "Clearing all nodes for dev reload")
    surfaces.values.forEach { state ->
      state.frameScheduler.cancelFlush()
      state.pendingTextRebuild.clear()
      state.pendingViewOperations.clear()
      state.pendingNativeOperations.clear()
      state.stickyFrameCarryover.clear()
      state.frameCommitCoordinator.cancel()
      state.layoutFlush.flush()
    }
    handler.removeCallbacksAndMessages(null)
    eventPayloads.clear()
    // Remove all nodes across all surfaces (starting from leaves).
    surfaces.values.forEach { state ->
      val ids = (0 until state.nodes.size()).map { state.nodes.keyAt(it) }
      ids.forEach { id ->
        if (id != state.rootView.rootId) {
          state.nodeFactory.removeNodeRecursive(id)
        }
      }
      state.nodes.get(state.rootView.rootId)?.children?.clear()
    }
    nextId = root.rootId + 1
    nodeToSurfaceId.clear()
    
    // Clear recycling pool to free memory
    nodeRecyclingPool.clear()

    surfaces.values.forEach { it.engine.reset() }
  }

  private fun runOnMainThread(block: () -> Unit) {
    layoutFlush.runOnMainThread(block)
  }

  override fun dequeueEventPayload(nodeId: Int, event: String): String? {
    return dequeueEventPayloadJson(nodeId, event)
  }

  override fun flush() = onMain {
    val surface = currentSurface
    surface.trace("flush_request") {
      "viewOps=${surface.pendingViewOperations.size} nativeOps=${surface.pendingNativeOperations.size}"
    }
    surface.layoutFlush.flush()
  }

  private fun scheduleFlush(
    priority: FlushPriority = FlushPriority.NORMAL,
    surface: SurfaceState = currentSurface
  ) {
    scheduleFlushCount++
    
    val viewOps = surface.pendingViewOperations.size
    val nativeOps = surface.pendingNativeOperations.size
    val shouldUseBarrier = when (frameBarrierScope) {
      "always" -> true
      "off", "never", "none", "disabled" -> false
      else -> !surface.hasDispatchedFirstFrame
    }
    val blockReason = if (shouldUseBarrier) surface.describeVisualMutationReason() else null
    blockReason?.let { surface.frameCommitCoordinator.onMutationsQueued(it) }
    
    // Track peak queue sizes
    if (viewOps > maxViewOps) {
      maxViewOps = viewOps
      if (viewOps > 50 && viewOps % 10 == 0) { // Only log every 10 to reduce spam
        // Log.w("RunePerf", "📈 NEW MAX view operations: $maxViewOps (nodes: ${nodes.size()})")
      }
    }
    if (nativeOps > maxNativeOps) {
      maxNativeOps = nativeOps
      if (nativeOps > 100 && nativeOps % 25 == 0) { // Only log every 25 to reduce spam
        // Log.w("RunePerf", "📈 NEW MAX native operations: $maxNativeOps (nodes: ${nodes.size()})")
      }
    }
    
    // Warn if queues are growing large (less frequently to avoid log spam)
    if ((viewOps > 100 || nativeOps > 200) && scheduleFlushCount % 50 == 0) {
      // Log.e("RunePerf", "🚨 LARGE OPERATION QUEUES: view=$viewOps native=$nativeOps (schedule #$scheduleFlushCount)")
    }
    
    surface.trace("scheduleFlush") {
      "priority=$priority viewOps=$viewOps nativeOps=$nativeOps pendingText=${surface.pendingTextRebuild.size} dirty=${surface.layoutFlush.dirty} block=${blockReason != null}"
    }

    surface.layoutFlush.scheduleFlush(priority)
  }

  /**
   * Debug method to log current recycling pool metrics.
   * Call this to see pool efficiency during development.
   */
  fun logRecyclingPoolMetrics() {
    if (!isNativeDebugEnabled()) return
    nodeRecyclingPool.logMetrics()
  }
  
  /**
   * Log performance statistics for debugging.
   */
  fun logPerformanceStats() {
    val nodeCountDiff = totalNodesCreated - totalNodesRemoved
    val expectedNodeCount = nodes.size()
    val leakedNodes = nodeCountDiff - expectedNodeCount
    val currentViewOps = surfaces.values.sumOf { it.pendingViewOperations.size }
    val currentNativeOps = surfaces.values.sumOf { it.pendingNativeOperations.size }
    val totalFlushes = surfaces.values.sumOf { it.layoutFlush.totalFlushes }
    val slowFlushes = surfaces.values.sumOf { it.layoutFlush.slowFlushCount }
    val totalFlushTime = surfaces.values.sumOf { it.layoutFlush.totalFlushTime }
    
    Log.i("RunePerf", """
      📊 PERFORMANCE STATS:
        - scheduleFlush calls: $scheduleFlushCount
        - Peak view ops: $maxViewOps
        - Peak native ops: $maxNativeOps
        - Current nodes: ${nodes.size()}
        - Nodes created: $totalNodesCreated
        - Nodes removed: $totalNodesRemoved
        - Expected node count: $nodeCountDiff
        - Leaked nodes: $leakedNodes
        - Current view ops: $currentViewOps
        - Current native ops: $currentNativeOps
        - Flush stats: $totalFlushes total, $slowFlushes slow (${if (totalFlushes > 0) slowFlushes * 100 / totalFlushes else 0}%)
        - Avg flush time: ${if (totalFlushes > 0) totalFlushTime / totalFlushes else 0}ms
    """.trimIndent())
    
    if (leakedNodes > 50) {
      Log.e("RunePerf", "🚨 MEMORY LEAK DETECTED: $leakedNodes nodes not properly cleaned up!")
    }
  }

  private inline fun SurfaceState.trace(event: String, detailsBuilder: () -> String) {
    val tracer = visualTracer ?: return
    tracer.trace(event, detailsBuilder())
  }

  private fun SurfaceState.trace(event: String, details: String?) {
    visualTracer?.trace(event, details)
  }

  private fun SurfaceState.hasVisualNativeMutations(): Boolean {
    for (op in pendingNativeOperations) {
      when (op) {
        is NativeOperation.SetProp,
        is NativeOperation.SetText -> return true
        else -> continue
      }
    }
    return false
  }

  private fun SurfaceState.describeVisualMutationReason(): String? {
    return when {
      pendingViewOperations.isNotEmpty() -> "viewOps=${pendingViewOperations.size}"
      pendingTextRebuild.isNotEmpty() -> "textRebuild=${pendingTextRebuild.size}"
      hasVisualNativeMutations() -> "nativeOps=${pendingNativeOperations.size}"
      else -> null
    }
  }

  private fun recordSurfaceMetrics(metrics: RuneLayoutFlush.FlushMetrics) {
    surfaceMetrics[metrics.surfaceId] = metrics
    val message = buildString {
      append("surface=")
      append(metrics.surfaceId)
      append(" iterations=")
      append(metrics.iterationCount)
      append(" total=")
      append(metrics.totalDurationMs)
      append("ms viewOps=")
      append(metrics.initialViewOps)
      append(" nativeOps=")
      append(metrics.initialNativeOps)
      append(" firstFrameDelay=")
      append(metrics.firstFrameDelayMs ?: -1)
      append("ms")
      if (metrics.iterationCapHit) {
        append(" cap-hit")
      }
    }
    when {
      metrics.iterationCapHit || metrics.totalDurationMs > 24 -> Log.w("RunePerf", message)
      isNativeDebugEnabled() -> Log.d("RunePerf", message)
    }
  }

  /**
   * Get current recycling pool metrics.
   * Useful for telemetry or performance monitoring.
   */
  internal fun getRecyclingPoolMetrics(): NodeRecyclingPool.RecyclingMetrics {
    return nodeRecyclingPool.getMetrics()
  }

  private inline fun <T> onMain(crossinline block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      return block()
    }
    var result: T? = null
    val latch = CountDownLatch(1)
    handler.post {
      result = block()
      latch.countDown()
    }
    latch.await()
    @Suppress("UNCHECKED_CAST")
    return result as T
  }

  companion object {
    private const val TEXT_TYPE = "text"
    private const val IMAGE_TYPE = "image"
    private const val TEXT_INPUT_TYPE = "text-input"
    private const val SECURE_TEXT_INPUT_TYPE = "secure-text-input"
    private const val SCROLL_VIEW_TYPE = "scroll-view"
    private const val BUTTON_TYPE = "button"
    private const val DEFAULT_PERSPECTIVE = 500f
    private const val PERSPECTIVE_SCALE = 3200f / DEFAULT_PERSPECTIVE
    private var testIdWarningLogged = false
    private val TEXT_INPUT_MEASURE_PROPS = setOf(
      "style",
      "multiline",
      "numberOfLines",
      "maxLength",
      "secureTextEntry",
      "inputMode",
      "autoCapitalize",
      "autoCorrect",
      "spellCheck",
      "editable",
      "placeholder",
      "selection",
      "selectionColor",
      "caretColor",
      "eventThrottleMs",
      "allowProgrammaticJumpDuringEdit",
      "returnKeyType",
      "blurOnSubmit",
      "submitBehavior",
    )
  }
}
