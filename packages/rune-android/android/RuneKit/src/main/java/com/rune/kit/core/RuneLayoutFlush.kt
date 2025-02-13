package com.rune.kit.core

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.SparseArray
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.TextView
import com.rune.kit.debug.PerformanceProfiler
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.Rect
import java.util.concurrent.CountDownLatch

/**
 * RuneLayoutFlush handles all layout flushing, frame scheduling, and view operation batching.
 * 
 * Responsibilities:
 * - Coordinate flush operations with priority scheduling
 * - Process pending native (prop/text/handler) operations
 * - Process pending view operations (insert/remove)
 * - Execute the main layout calculation and frame application (performFlush)
 * - Manage text rebuilds and view detachment
 * - Thread-safe execution on main thread
 */
internal class RuneLayoutFlush(
  private val root: RuneRootView,
  private val nodes: SparseArray<RuneUIManager.Node>,
    private val engine: LayoutEngine,
    private val handler: Handler,
    private val frameScheduler: FrameScheduler,
    private val pendingNativeOperations: MutableList<NativeOperation>,
    private val pendingViewOperations: MutableList<ViewOperation>,
    private val pendingTextRebuild: LinkedHashSet<Int>,
    private val stickyFrameCarryover: MutableSet<Int>,
    private val buttonStyles: SparseArray<ButtonVisualStyle>,
    private val isVirtualTextNode: (RuneUIManager.Node) -> Boolean,
    private val recomputeTextForNode: (RuneUIManager.Node?) -> String,
    private val applySetProp: (Int, String, String?) -> Unit,
    private val applySetText: (Int, String) -> Unit,
    private val applySetHandler: (Int, String, Long) -> Unit,
    private val logDebug: (String, String) -> Unit,
    private val isNativeDebugEnabled: () -> Boolean,
) {

  // Component type constants
  private val TEXT_TYPE = "text"
  private val IMAGE_TYPE = "image"
  private val TEXT_INPUT_TYPE = "text-input"
  private val SECURE_TEXT_INPUT_TYPE = "secure-text-input"
  private val SCROLL_VIEW_TYPE = "scroll-view"
  private val BUTTON_TYPE = "button"
  private val PRESSABLE_TYPE = "pressable"
  private val DEBUG_SCROLL_LAYOUT = false
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

  // State management
  @Volatile var dirty = false
  @Volatile var layoutTransactionActive = false
  @Volatile var viewTransactionInProgress = false
  var flushCoalesceScheduled = false
  var pendingFlushPriority = FlushPriority.NORMAL
  var lastRootWidth = -1
  var lastRootHeight = -1

  // ==================== Operation Processing ====================

  private fun shouldPrioritizeTextInputProp(operation: NativeOperation.SetProp): Boolean {
    val node = nodes.get(operation.nodeId) ?: return false
    val isTextInput = node.type == TEXT_INPUT_TYPE || node.type == SECURE_TEXT_INPUT_TYPE
    return isTextInput && TEXT_INPUT_MEASURE_PROPS.contains(operation.name)
  }

  internal fun processPendingNativeOperations() {
    if (pendingNativeOperations.isEmpty()) return
    val operations = pendingNativeOperations.toList()
    pendingNativeOperations.clear()
    val prioritized = mutableListOf<NativeOperation>()
    val remaining = mutableListOf<NativeOperation>()
    operations.forEach { op ->
      if (op is NativeOperation.SetProp && shouldPrioritizeTextInputProp(op)) {
        prioritized.add(op)
      } else {
        remaining.add(op)
      }
    }
    (prioritized + remaining).forEach { op ->
      when (op) {
        is NativeOperation.SetProp -> applySetProp(op.nodeId, op.name, op.jsonValue)
        is NativeOperation.SetText -> applySetText(op.nodeId, op.text)
        is NativeOperation.SetHandler -> applySetHandler(op.nodeId, op.event, op.handlerId)
      }
    }
  }

  internal fun processPendingViewOperations() {
    if (pendingViewOperations.isEmpty() || viewTransactionInProgress) return
    viewTransactionInProgress = true
    try {
      val operationsByParent = pendingViewOperations.groupBy {
        when (it) {
          is ViewOperation.Insert -> it.parentId
          is ViewOperation.Remove -> it.parentId
        }
      }
      operationsByParent.forEach { (parentId, operations) ->
        val parentView = if (parentId == root.rootId) {
          root
        } else {
          nodes.get(parentId)?.view as? ViewGroup
        }

        if (parentView == null) {
          operations.filterIsInstance<ViewOperation.Remove>().forEach { op ->
            detachChildView(parentId, op.node)
          }
          return@forEach
        }

        parentView.suppressLayoutCompat(true)
        try {
          operations.forEach { operation ->
            when (operation) {
              is ViewOperation.Insert -> {
                val childNode = nodes.get(operation.childId)
                if (childNode == null) {
                  Log.w(
                    "RuneUI",
                    "processPendingViewOperations: insert node ${operation.childId} missing for parent $parentId",
                  )
                  return@forEach
                }
                val childView = childNode.view
                (childView.parent as? ViewGroup)?.removeView(childView)
                val safeIndex = operation.index.coerceIn(0, parentView.childCount)
                parentView.addView(childView, safeIndex)
                if (
                  !childNode.hasCompletedInitialMount &&
                  (childNode.type == TEXT_INPUT_TYPE || childNode.type == SECURE_TEXT_INPUT_TYPE)
                ) {
                  scheduleFlush(FlushPriority.HIGH)
                }
                childNode.hasCompletedInitialMount = true
              }
              is ViewOperation.Remove -> {
                detachChildView(operation.parentId, operation.node)
              }
            }
          }
        } finally {
          parentView.suppressLayoutCompat(false)
        }
      }
    } finally {
      pendingViewOperations.clear()
      viewTransactionInProgress = false
    }
  }

  // ==================== Flush & Layout Coordination ====================

  internal fun flush() = onMain {
    dirty = true
    if (layoutTransactionActive) return@onMain
    if (root.width > 0 && root.height > 0) {
      frameScheduler.cancelFlush()
      performFlush()
    } else {
      scheduleFlush()
    }
  }

  internal fun scheduleFlush(priority: FlushPriority = FlushPriority.NORMAL) {
    dirty = true
    if (layoutTransactionActive) return
    if (priority.ordinal < pendingFlushPriority.ordinal) {
      pendingFlushPriority = priority
    }
    if (flushCoalesceScheduled) return
    flushCoalesceScheduled = true
    frameScheduler.scheduleFlush {
      flushCoalesceScheduled = false
      val dispatchPriority = pendingFlushPriority
      pendingFlushPriority = FlushPriority.NORMAL
      if (layoutTransactionActive) {
        scheduleFlush(dispatchPriority)
        return@scheduleFlush
      }
      if (dirty) {
        performFlush()
      }
    }
  }

  internal fun performFlush() {
    if (layoutTransactionActive) return
    layoutTransactionActive = true
    root.suppressLayoutCompat(true)
    val stickyRelayoutNodes = mutableSetOf<Int>()
    try {
      if (root.width == 0 || root.height == 0) {
        handler.post { performFlush() }
        return
      }

      if (!dirty && pendingNativeOperations.isEmpty() && pendingViewOperations.isEmpty()) return

      do {
        dirty = false

        PerformanceProfiler.recordLayoutStart()
        processPendingNativeOperations()
        processPendingViewOperations()
        drainPendingTextRebuilds()

        val previousFrames = SparseArray<Rect>()
        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (node.view.visibility == View.VISIBLE) {
            previousFrames.put(node.id, Rect(
              node.view.left,
              node.view.top,
              node.view.right,
              node.view.bottom,
            ))
          }
        }

        engine.calculateLayout(root.width, root.height)
        PerformanceProfiler.recordLayoutEnd()

        PerformanceProfiler.recordRenderStart()

        val appliedFrames = SparseArray<Rect>()
        val stickyNodesForRelayout = mutableSetOf<Int>()
        val stickyFramesUsedThisFrame = mutableSetOf<Int>()

        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (isVirtualTextNode(node)) continue
          val rawFrame: Rect = engine.frame(node.id)
          val rawWidth = rawFrame.right - rawFrame.left
          val rawHeight = rawFrame.bottom - rawFrame.top
          val previous = previousFrames.get(node.id)
          val previousWidth = previous?.let { it.right - it.left } ?: 0
          val previousHeight = previous?.let { it.bottom - it.top } ?: 0
          val shouldReusePrevious = (rawWidth <= 0 || rawHeight <= 0) &&
            previousWidth > 0 &&
            previousHeight > 0 &&
            !stickyFrameCarryover.contains(node.id)

          val appliedFrame = if (shouldReusePrevious && previous != null) {
            stickyNodesForRelayout.add(node.id)
            stickyFramesUsedThisFrame.add(node.id)
            previous
          } else {
            stickyFrameCarryover.remove(node.id)
            rawFrame
          }
          appliedFrames.put(node.id, appliedFrame)
            val parentId = node.parentId
            val parentType = parentId?.let { nodes.get(it)?.type }
          if (
            DEBUG_SCROLL_LAYOUT &&
            (node.type == SCROLL_VIEW_TYPE || parentType == SCROLL_VIEW_TYPE)
          ) {
            val vg = node.view as? ViewGroup
            val childCount = vg?.childCount ?: -1
            if (isNativeDebugEnabled()) {
              Log.d(
                "RuneUI",
                "[layout] node=${node.id} type=${node.type} parentType=$parentType raw=(${rawFrame.left},${rawFrame.top},${rawFrame.right},${rawFrame.bottom}) applied=(${appliedFrame.left},${appliedFrame.top},${appliedFrame.right},${appliedFrame.bottom}) children=$childCount reused=$shouldReusePrevious"
              )
            }
          }

          val width = (appliedFrame.right - appliedFrame.left).coerceAtLeast(0)
          val height = (appliedFrame.bottom - appliedFrame.top).coerceAtLeast(0)

          val layoutParams = when (val current = node.view.layoutParams) {
            is android.widget.FrameLayout.LayoutParams -> current
            else -> android.widget.FrameLayout.LayoutParams(width.coerceAtLeast(0), height.coerceAtLeast(0))
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
          if (layoutParams.leftMargin != appliedFrame.left) {
            layoutParams.leftMargin = appliedFrame.left
            paramsChanged = true
          }
          if (layoutParams.topMargin != appliedFrame.top) {
            layoutParams.topMargin = appliedFrame.top
            paramsChanged = true
          }
          if (layoutParams.gravity != (android.view.Gravity.START or android.view.Gravity.TOP)) {
            layoutParams.gravity = android.view.Gravity.START or android.view.Gravity.TOP
            paramsChanged = true
          }
          if (paramsChanged) {
            node.view.layoutParams = layoutParams
          }

          // Ensure the measured dimensions stay in sync with Yoga so scroll containers pick up correct sizes.
          val targetWidthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
          val targetHeightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
          if (
            node.view.measuredWidth != width ||
            node.view.measuredHeight != height
          ) {
            node.view.measure(targetWidthSpec, targetHeightSpec)
          }
        }

        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (isVirtualTextNode(node)) continue
          val appliedFrame = appliedFrames.get(node.id) ?: engine.frame(node.id)
          node.view.layout(appliedFrame.left, appliedFrame.top, appliedFrame.right, appliedFrame.bottom)
          if (node.type != TEXT_TYPE) {
            node.label?.layout(0, 0, appliedFrame.right - appliedFrame.left, appliedFrame.bottom - appliedFrame.top)
          }
        }

        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (isVirtualTextNode(node)) continue
          val appliedFrame = appliedFrames.get(node.id) ?: engine.frame(node.id)
          val hasSize = (appliedFrame.right - appliedFrame.left) > 0 && (appliedFrame.bottom - appliedFrame.top) > 0
          node.view.visibility = if (hasSize) View.VISIBLE else View.INVISIBLE
          if (hasSize) {
            node.label?.alpha = 1f
          }
        }
        stickyFrameCarryover.clear()
        stickyFrameCarryover.addAll(stickyFramesUsedThisFrame)
        if (stickyNodesForRelayout.isNotEmpty()) {
          stickyRelayoutNodes.addAll(stickyNodesForRelayout)
        }
        PerformanceProfiler.recordRenderEnd()
      } while (dirty || pendingNativeOperations.isNotEmpty() || pendingViewOperations.isNotEmpty())
      if (stickyRelayoutNodes.isNotEmpty()) {
        stickyRelayoutNodes.forEach { engine.markDirty(it) }
      }
    } finally {
      root.suppressLayoutCompat(false)
      layoutTransactionActive = false
      val hasPendingOperations = dirty || pendingNativeOperations.isNotEmpty() || pendingViewOperations.isNotEmpty()
      when {
        stickyRelayoutNodes.isNotEmpty() -> scheduleFlush(FlushPriority.HIGH)
        hasPendingOperations -> scheduleFlush()
      }
    }
  }

  // ==================== Layout Helpers ====================

  private fun drainPendingTextRebuilds() {
    if (pendingTextRebuild.isEmpty()) return
    val toProcess = pendingTextRebuild.toList()
    pendingTextRebuild.clear()
    toProcess.forEach { nodeId ->
      val node = nodes.get(nodeId) ?: return@forEach
      if (node.type != TEXT_TYPE) return@forEach
      val newText = recomputeTextForNode(node)
      node.cachedText = newText
      node.label?.text = newText
      (node.view as? TextView)?.text = newText
    }
  }

  private fun detachChildView(parentId: Int, childNode: RuneUIManager.Node) {
    val expectedParentView = when {
      parentId == root.rootId -> root
      else -> nodes.get(parentId)?.view as? ViewGroup
    }
    val childView = childNode.view

    var wasRemoved = false
    if (expectedParentView != null) {
      val index = expectedParentView.indexOfChild(childView)
      if (index >= 0) {
        expectedParentView.removeViewAt(index)
        wasRemoved = true
      }
    }

    if (!wasRemoved) {
      val actualParent = childView.parent as? ViewGroup
      if (actualParent != null) {
        actualParent.removeView(childView)
        wasRemoved = true
      }
    }

    if (!wasRemoved) {
      Log.w(
        "RuneUI",
        "detachChildView: unable to locate view for node ${childNode.id} under parent $parentId; view may already be detached",
      )
    }
  }

  // ==================== Threading Utilities ====================

  internal fun runOnMainThread(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      handler.post { block() }
    }
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
}
