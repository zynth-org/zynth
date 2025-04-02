package com.rune.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import com.rune.kit.runtime.JSBridge
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener
import org.json.JSONArray
import java.util.HashMap
import java.util.LinkedHashSet
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
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
  private val engine: LayoutEngine,
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

  init {
    RuneComponentRegistry.ensureInitialized()
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

  // Public accessor methods for component packages
  fun getRootView(): RuneRootView = root
  fun getLayoutEngine(): LayoutEngine = engine

  private fun processPendingViewOperations() {
    layoutFlush.processPendingViewOperations()
  }

  private fun applySetProp(nodeId: Int, name: String, jsonValue: String?, category: PropertyCategory = PropertyCategory.UNKNOWN) {
    propApplier.applySetProp(nodeId, name, jsonValue, category)
  }

  private fun applySetText(nodeId: Int, text: String) {
    propApplier.applySetText(nodeId, text, ::propagateTextChange)
  }

  private fun applySetHandler(nodeId: Int, event: String, handlerId: Long) {
    propApplier.applySetHandler(nodeId, event, eventDispatcher, handlerListener, handlerId)
  }

  private val nodes = SparseArray<Node>()
  private val pendingTextRebuild = LinkedHashSet<Int>()
  private val handler = Handler(Looper.getMainLooper())
  private val frameScheduler = FrameScheduler()
  private val eventPayloads = HashMap<String, ArrayDeque<String>>()
  private val pendingViewOperations = mutableListOf<ViewOperation>()
  private val pendingNativeOperations = mutableListOf<NativeOperation>()
  private val stickyFrameCarryover = mutableSetOf<Int>()
  private val nodeRecyclingPool = NodeRecyclingPool(
    debugLogging = isNativeDebugEnabled(),
  )
  private val propApplier = RunePropApplier(
    nodes = nodes,
    engine = engine,
    density = density,
    logDebug = ::logDebug,
    resolveTextNode = ::resolveTextNode,
    onTextInputTextUpdated = { _, _ -> },
    storeEventPayload = ::storeEventPayload,
  )
  private val eventManager = RuneEventManager(
    nodes = nodes,
    engine = engine,
    eventDispatcher = eventDispatcher,
    handlerListener = handlerListener,
    eventPayloads = eventPayloads,
  )
  private val recyclerHost = RuneRecyclerHost()
  private val nodeFactory = RuneNodeFactory(
    root = root,
    nodes = nodes,
    engine = engine,
    pendingTextRebuild = pendingTextRebuild,
    nodeRecyclingPool = nodeRecyclingPool,
    getNextId = { nextId },
    incrementNextId = { nextId++ },
    scheduleFlush = { priority: FlushPriority -> layoutFlush.scheduleFlush(priority) },
    logDebug = ::logDebug,
    manager = this,
  )
  private val layoutFlush = RuneLayoutFlush(
    root = root,
    nodes = nodes,
    engine = engine,
    handler = handler,
    frameScheduler = frameScheduler,
    pendingNativeOperations = pendingNativeOperations,
    pendingViewOperations = pendingViewOperations,
    pendingTextRebuild = pendingTextRebuild,
    stickyFrameCarryover = stickyFrameCarryover,
    isVirtualTextNode = ::isVirtualTextNode,
    recomputeTextForNode = ::recomputeTextForNode,
    applySetProp = ::applySetProp,
    applySetText = ::applySetText,
    applySetHandler = ::applySetHandler,
    logDebug = ::logDebug,
    isNativeDebugEnabled = ::isNativeDebugEnabled,
  )
  @Volatile private var viewTransactionInProgress = false
  @Volatile private var layoutTransactionActive = false
  private var flushCoalesceScheduled = false
  private var pendingFlushPriority = FlushPriority.NORMAL
  private var nextId = root.rootId + 1
  @Volatile private var dirty = false
  private var lastRootWidth = -1
  private var lastRootHeight = -1
  
  // Performance tracking for operation queues
  private var maxViewOps = 0
  private var maxNativeOps = 0
  private var scheduleFlushCount = 0
  private var totalNodesCreated = 0
  private var totalNodesRemoved = 0

  init {
    // root has no parent by design; no global parents map needed
    root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      val w = root.width
      val h = root.height
      if (w != lastRootWidth || h != lastRootHeight) {
        lastRootWidth = w
        lastRootHeight = h
        scheduleFlush()
        flush()
      }
    }
  }

  private fun storeEventPayload(nodeId: Int, event: String, payload: JSONObject?) {
    eventManager.storeEventPayload(nodeId, event, payload)
  }

  // Child management helpers: lazily allocate children list on first attach
  private fun attachChild(parentId: Int, childId: Int, atIndex: Int = -1) {
    val parentNode = nodes.get(parentId)
    val childNode = nodes.get(childId)
    // still allow attaching even if node isn't created yet; parentId is set on child when created
    if (parentNode == null || childNode == null) {
      // fallback to setting parentId on the child Node if it exists
      nodes.get(childId)?.parentId = parentId
      return
    }

    if (parentNode.children == null) parentNode.children = ArrayList()
    val list = parentNode.children!!
    val insertPos = if (atIndex < 0 || atIndex > list.size) list.size else atIndex
    // remove existing occurrence (defensive)
    list.remove(childId)
    list.add(insertPos, childId)

    childNode.parentId = parentId
    childNode.index = insertPos

    // update indices of following siblings
    for (i in insertPos + 1 until list.size) {
      nodes.get(list[i])?.index = i
    }
  }

  private fun detachChild(parentId: Int, childId: Int) {
    val parentNode = nodes.get(parentId) ?: return
    val list = parentNode.children ?: return
    val idx = list.indexOf(childId)
    if (idx >= 0) {
      list.removeAt(idx)
      for (i in idx until list.size) {
        nodes.get(list[i])?.index = i
      }
      nodes.get(childId)?.parentId = null
      nodes.get(childId)?.index = -1
      if (list.isEmpty()) parentNode.children = null
    }
  }

  fun consumeEventPayload(nodeId: Int, event: String): JSONObject? {
    return eventManager.consumeEventPayload(nodeId, event)
  }

  fun dequeueEventPayloadJson(nodeId: Int, event: String): String? {
    return eventManager.dequeueEventPayloadJson(nodeId, event)
  }

  private fun isVirtualTextNode(node: Node): Boolean {
    return nodeFactory.isVirtualTextNode(node)
  }

  private fun recomputeTextForNode(node: Node?): String {
    return nodeFactory.recomputeTextForNode(node)
  }

  private fun propagateTextChange(node: Node) {
    nodeFactory.propagateTextChange(node)
  }

  private fun recomputeAndPropagate(node: Node) {
    nodeFactory.recomputeAndPropagate(node)
  }

  private fun resolveTextNode(id: Int): Node? {
    return nodeFactory.resolveTextNode(id)
  }

  override fun createNode(type: String): Int = onMain {
    // RECYCLING DISABLED - causing bugs without fixing performance
    // The real issue is elsewhere (scroll offset updates, layout calculations)
    
    val createStart = android.os.SystemClock.elapsedRealtime()
    
    // Create new node from scratch
    val id = nodeFactory.createNode(type)
    
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
    eventManager.dispatchEvent(nodeId, event, payload)
  }

  /**
   * Allow components to provide custom Yoga measurement for their nodes.
   */
  fun setMeasureHandler(nodeId: Int, handler: MeasureHandler?) {
    engine.setMeasureHandler(nodeId, handler)
    if (handler != null) {
      markNodeDirty(nodeId)
    }
  }

  /**
   * Generic API to mark a node's layout as dirty and trigger relayout.
   * Used by components when their intrinsic size changes.
   */
  fun markNodeDirty(nodeId: Int) {
    engine.markDirty(nodeId)
    scheduleFlush(FlushPriority.HIGH)
  }

  override fun onPressablePressIn(nodeId: Int, payload: JSONObject) {
    eventManager.onPressablePressIn(nodeId, payload)
  }

  override fun onPressablePressOut(nodeId: Int, payload: JSONObject, cancelled: Boolean) {
    eventManager.onPressablePressOut(nodeId, payload, cancelled)
  }

  override fun onPressablePress(nodeId: Int, payload: JSONObject) {
    eventManager.onPressablePress(nodeId, payload)
  }

  override fun onPressableLongPress(nodeId: Int, durationMs: Long, payload: JSONObject) {
    eventManager.onPressableLongPress(nodeId, durationMs, payload)
  }

  override fun onPressableDoublePress(nodeId: Int, payload: JSONObject) {
    eventManager.onPressableDoublePress(nodeId, payload)
  }

  override fun onPressableHover(nodeId: Int, hovering: Boolean) {
    eventManager.onPressableHover(nodeId, hovering)
  }

  override fun onPressableFocus(nodeId: Int) {
    eventManager.onPressableFocus(nodeId)
  }

  override fun onPressableBlur(nodeId: Int) {
    eventManager.onPressableBlur(nodeId)
  }

  override fun onPressableKeyEvent(nodeId: Int, phase: String, payload: JSONObject) {
    eventManager.onPressableKeyEvent(nodeId, phase, payload)
  }

  override fun onPressableCancel(nodeId: Int, payload: JSONObject) {
    eventManager.onPressableCancel(nodeId, payload)
  }

  fun applyBatch(batchJson: String?) = onMain {
    if (batchJson.isNullOrBlank()) return@onMain
    val payload = runCatching { JSONObject(batchJson) }.getOrNull() ?: return@onMain
    val operations = payload.optJSONArray("operations") ?: return@onMain
    recyclerHost.onBatch(payload.optJSONObject("meta"), operations)

    var mutated = false
    for (i in 0 until operations.length()) {
      val op = operations.optJSONObject(i) ?: continue
      when (op.optString("type")) {
        "setProp" -> {
          val nodeId = op.optInt("nodeId", -1)
          if (nodeId < 0) continue
          val name = op.optString("name")
          if (name.isBlank()) continue
          val value = op.opt("value")
          val jsonValue = encodeBatchValue(value)
          val category = PropertyCategoryMap.getCategory(name)
          pendingNativeOperations.add(
            NativeOperation.SetProp(
              nodeId = nodeId,
              name = name,
              jsonValue = jsonValue,
              parsedValue = if (value === JSONObject.NULL) null else value,
              category = category,
            ),
          )
          mutated = true
        }
        "setText" -> {
          val nodeId = op.optInt("nodeId", -1)
          if (nodeId < 0) continue
          val value = op.opt("value")
          val text = when (value) {
            null, JSONObject.NULL -> ""
            else -> value.toString()
          }
          pendingNativeOperations.add(NativeOperation.SetText(nodeId, text))
          mutated = true
        }
      }
    }

    if (mutated) {
      scheduleFlush()
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

  override fun setProp(nodeId: Int, name: String, jsonValue: String?) = onMain {
    // Fast O(1) property categorization for optimized dispatch
    val category = PropertyCategoryMap.getCategory(name)
    
    // Optionally pre-parse value for certain categories (future optimization)
    // For now, we defer parsing until application
    val parsedValue: Any? = null
    
    // Deduplicate: remove any previous setProp for same node+property
    // Use reversed iteration for better performance when removing from end
    val iterator = pendingNativeOperations.listIterator(pendingNativeOperations.size)
    var removedCount = 0
    while (iterator.hasPrevious() && removedCount < 20) {
      val op = iterator.previous()
      if (op is NativeOperation.SetProp && op.nodeId == nodeId && op.name == name) {
        iterator.remove()
        break // Only one setProp per node+property needed
      }
      removedCount++
    }
    
    pendingNativeOperations.add(
      NativeOperation.SetProp(
        nodeId = nodeId,
        name = name,
        jsonValue = jsonValue,
        parsedValue = parsedValue,
        category = category
      )
    )
    scheduleFlush()
  }

  override fun setText(nodeId: Int, text: String) = onMain {
    // Deduplicate: remove any previous setText for same node
    // Use reversed iteration for better performance when removing from end
    val iterator = pendingNativeOperations.listIterator(pendingNativeOperations.size)
    var removedCount = 0
    while (iterator.hasPrevious() && removedCount < 10) {
      val op = iterator.previous()
      if (op is NativeOperation.SetText && op.nodeId == nodeId) {
        iterator.remove()
        break // Only one setText per node needed
      }
      removedCount++
    }
    
    pendingNativeOperations.add(NativeOperation.SetText(nodeId, text))
    scheduleFlush()
  }

  override fun insertChild(parentId: Int, childId: Int, index: Int) = onMain {
    attachChild(parentId, childId, index)
    val parentNode = nodes.get(parentId)
    if (parentNode?.type == TEXT_TYPE) {
      // If parent is a text node, merge text content from child instead of nesting views
      val childNode = nodes.get(childId)
      if (childNode?.type == TEXT_TYPE) {
        val insertIndex = index.coerceIn(0, parentNode.textChildren.size)
        parentNode.textChildren.remove(childId)
        parentNode.textChildren.add(insertIndex, childId)
        pendingTextRebuild.add(parentNode.id)
        engine.markDirty(parentNode.id)
        propagateTextChange(parentNode)
      }
      scheduleFlush()
      return@onMain
    }
    val node = nodes.get(childId)
    if (node == null) {
      Log.w("RuneUI", "insertChild: node $childId not found for parent $parentId")
      return@onMain
    }
    pendingViewOperations.removeAll { op ->
      op is ViewOperation.Remove && op.node.id == childId
    }
    pendingViewOperations.add(ViewOperation.Insert(parentId, childId, index))
    engine.insertChild(parentId, childId, index)
    scheduleFlush()
  }

  override fun removeChild(parentId: Int, childId: Int) = onMain {
    // Track removal frequency
    if (totalNodesRemoved % 10 == 0 && totalNodesRemoved > 0) {
      // Log.i("RunePerf", "🗑️ removeChild called (total removed: $totalNodesRemoved, current nodes: ${nodes.size()})")
    }
    
    val parentNode = nodes.get(parentId)
    if (parentNode?.type == TEXT_TYPE) {
      parentNode.textChildren.remove(childId)
      detachChild(parentId, childId)
      pendingTextRebuild.add(parentNode.id)
      engine.markDirty(parentNode.id)
      propagateTextChange(parentNode)
      scheduleFlush()
      return@onMain
    }

    val childNode = nodes.get(childId)
    if (childNode == null) {
      Log.w("RuneUI", "removeChild: node $childId not found for parent $parentId")
      return@onMain
    }
    
    totalNodesRemoved++
    
    pendingViewOperations.removeAll { op ->
      op is ViewOperation.Insert && op.parentId == parentId && op.childId == childId
    }
    
    // RECYCLING DISABLED - causing bugs without fixing performance
    // Normal removal and destruction
    pendingViewOperations.add(ViewOperation.Remove(parentId, childNode))
    nodeFactory.removeNodeRecursive(childId, detachView = false)
    scheduleFlush()
  }

  override fun setHandler(nodeId: Int, event: String, handlerId: Long) = onMain {
    pendingNativeOperations.add(NativeOperation.SetHandler(nodeId, event, handlerId))
    scheduleFlush()
  }

  override fun removeNode(nodeId: Int) = onMain {
    nodeFactory.removeNodeRecursive(nodeId)
    scheduleFlush()
  }

  fun hasRenderableContent(): Boolean = onMain { nodes.size() > 0 }

  fun clearAllNodes() = onMain {
    logDebug("RuneUI", "Clearing all nodes for dev reload")
    frameScheduler.cancelFlush()
    handler.removeCallbacksAndMessages(null)
    pendingTextRebuild.clear()
    pendingViewOperations.clear()
    pendingNativeOperations.clear()
    eventPayloads.clear()
    dirty = false
    viewTransactionInProgress = false
    flushCoalesceScheduled = false

    // Remove all nodes recursively starting from leaves
    val nodesToRemove = nodes.size().let { size ->
        (0 until size).map { nodes.keyAt(it) }
    }.filter { it != root.rootId }
    
    nodesToRemove.forEach { nodeId ->
        nodeFactory.removeNodeRecursive(nodeId)
    }

  // Final cleanup: clear children for root
  nodes.get(root.rootId)?.children?.clear()
    nextId = root.rootId + 1
    lastRootWidth = -1
    lastRootHeight = -1
    
    // Clear recycling pool to free memory
    nodeRecyclingPool.clear()

    engine.reset()
  }

  private fun runOnMainThread(block: () -> Unit) {
    layoutFlush.runOnMainThread(block)
  }

  override fun dequeueEventPayload(nodeId: Int, event: String): String? {
    return dequeueEventPayloadJson(nodeId, event)
  }

  override fun flush() = onMain {
    layoutFlush.flush()
  }

  private fun scheduleFlush(priority: FlushPriority = FlushPriority.NORMAL) {
    scheduleFlushCount++
    
    val viewOps = pendingViewOperations.size
    val nativeOps = pendingNativeOperations.size
    
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
    
    layoutFlush.scheduleFlush(priority)
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
        - Current view ops: ${pendingViewOperations.size}
        - Current native ops: ${pendingNativeOperations.size}
        - Flush stats: ${layoutFlush.totalFlushes} total, ${layoutFlush.slowFlushCount} slow (${if (layoutFlush.totalFlushes > 0) layoutFlush.slowFlushCount * 100 / layoutFlush.totalFlushes else 0}%)
        - Avg flush time: ${if (layoutFlush.totalFlushes > 0) layoutFlush.totalFlushTime / layoutFlush.totalFlushes else 0}ms
    """.trimIndent())
    
    if (leakedNodes > 50) {
      Log.e("RunePerf", "🚨 MEMORY LEAK DETECTED: $leakedNodes nodes not properly cleaned up!")
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
