package com.zynth.kit.core

import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.SparseArray
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.TextView
import com.zynth.kit.debug.PerformanceProfiler
import com.zynth.kit.layout.LayoutEngine
import com.zynth.kit.layout.Rect
import java.util.concurrent.CountDownLatch
import com.zynth.kit.core.TextComposer
import com.zynth.kit.core.TextStyleAttributes
import kotlin.math.abs

/**
 * ZynthLayoutFlush handles all layout flushing, frame scheduling, and view operation batching.
 * 
 * Responsibilities:
 * - Coordinate flush operations with priority scheduling
 * - Process pending native (prop/text/handler) operations
 * - Process pending view operations (insert/remove)
 * - Execute the main layout calculation and frame application (performFlush)
 * - Manage text rebuilds and view detachment
 * - Thread-safe execution on main thread
 */
private const val MAX_FLUSH_ITERATIONS = 4
private const val FLUSH_ITERATION_WARN_THRESHOLD_MS = 12L
private val MOUNT_HIDE_TIMEOUT_MS: Long by lazy {
  // How long to keep newly inserted nodes hidden if they were inserted before their first props arrive.
  // This trades "FOUC/flash" for "pop-in" on pathological batches where props are delayed.
  System.getProperty("zynth.mount.hideTimeoutMs")?.toLongOrNull()?.coerceAtLeast(0L) ?: 120L
}
private val routerPerfLoggingEnabled: Boolean by lazy {
  val property = System.getProperty("zynth.router.perfLogs")?.lowercase()
  val propertyEnabled = property == "1" || property == "true" || property == "on"
  propertyEnabled || Debug.isDebuggerConnected()
}

internal class ZynthLayoutFlush(
  private val root: ZynthRootView,
  private val nodes: SparseArray<ZynthUIManager.Node>,
  private val engine: LayoutEngine,
  private val handler: Handler,
  private val frameScheduler: FrameScheduler,
  private val pendingNativeOperations: MutableList<NativeOperation>,
  private val pendingViewOperations: MutableList<ViewOperation>,
  private val pendingTextRebuild: LinkedHashSet<Int>,
  private val stickyFrameCarryover: MutableSet<Int>,
  private val isVirtualTextNode: (ZynthUIManager.Node) -> Boolean,
  private val removeNodeRecursive: (Int) -> Unit,
  private val applySetProp: (Int, String, String?, PropertyCategory) -> Unit,
  private val applySetText: (Int, String) -> Unit,
  private val applySetHandler: (Int, String, Long) -> Unit,
  private val logDebug: (String, String) -> Unit,
  private val isNativeDebugEnabled: () -> Boolean,
  private val surfaceId: Int,
  private val frameCommitCoordinator: FrameCommitCoordinator,
  private val visualTracer: VisualStateTracer?,
  private val reportMetrics: (FlushMetrics) -> Unit = {},
) {
  private val textComposer = TextComposer(nodes)

  // Component type constants
  private val TEXT_TYPE = "text"
  private val IMAGE_TYPE = "image"
  private val TEXT_INPUT_TYPE = "text-input"
  private val SECURE_TEXT_INPUT_TYPE = "secure-text-input"
  private val SCROLL_VIEW_TYPE = "scroll-view"
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
  private var firstFrameCallback: (() -> Unit)? = null
  private var hasDispatchedFirstFrame = false
  @Volatile private var firstFrameStartTimeMs: Long? = null
  @Volatile private var lastFirstFrameDelayMs: Long? = null
  
  // Performance tracking
  var totalFlushes = 0
  var slowFlushCount = 0
  var totalFlushTime = 0L

  fun setOnFirstFrameCallback(callback: (() -> Unit)?) {
    firstFrameCallback = callback
    if (callback != null && hasDispatchedFirstFrame) {
      callback()
      firstFrameCallback = null
    }
  }

  // ==================== Operation Processing ====================

  private fun shouldPrioritizeTextInputProp(operation: NativeOperation.SetProp): Boolean {
    val node = nodes.get(operation.nodeId) ?: return false
    val isTextInput = node.type == TEXT_INPUT_TYPE || node.type == SECURE_TEXT_INPUT_TYPE
    return isTextInput && TEXT_INPUT_MEASURE_PROPS.contains(operation.name)
  }

  internal fun processPendingNativeOperations() {
    if (pendingNativeOperations.isEmpty()) return
    
    val startTime = android.os.SystemClock.elapsedRealtime()
    
    val operations = pendingNativeOperations.toList()
    pendingNativeOperations.clear()
    
    // Build set of nodes being removed to skip operations on them
    val nodesToRemove = pendingViewOperations
      .filterIsInstance<ViewOperation.Remove>()
      .map { it.node.id }
      .toSet()
    
    val prioritized = mutableListOf<NativeOperation>()
    val remaining = mutableListOf<NativeOperation>()
    var skippedCount = 0
    
    operations.forEach { op ->
      // Skip operations on nodes that are about to be removed
      val nodeId = when (op) {
        is NativeOperation.SetProp -> op.nodeId
        is NativeOperation.SetText -> op.nodeId
        is NativeOperation.SetHandler -> op.nodeId
      }
      
      if (nodesToRemove.contains(nodeId)) {
        skippedCount++
        return@forEach
      }
      
      if (op is NativeOperation.SetProp && shouldPrioritizeTextInputProp(op)) {
        prioritized.add(op)
      } else {
        remaining.add(op)
      }
    }
    
    (prioritized + remaining).forEach { op ->
      when (op) {
        is NativeOperation.SetProp -> applySetProp(op.nodeId, op.name, op.jsonValue, op.category)
        is NativeOperation.SetText -> applySetText(op.nodeId, op.text)
        is NativeOperation.SetHandler -> applySetHandler(op.nodeId, op.event, op.handlerId)
      }
    }
    
    val elapsed = android.os.SystemClock.elapsedRealtime() - startTime
    if (elapsed > 5 || skippedCount > 0) {
      // Log.w("ZynthPerf", "⚠️ processPendingNativeOperations: ${elapsed}ms for $initialCount ops (processed: $processedCount, skipped: $skippedCount, prioritized: ${prioritized.size})")
    }
  }

  internal fun processPendingViewOperations() {
    if (pendingViewOperations.isEmpty() || viewTransactionInProgress) return
    
    val startTime = android.os.SystemClock.elapsedRealtime()
    
    viewTransactionInProgress = true
    try {
      val operationsByParent = pendingViewOperations.groupBy {
        when (it) {
          is ViewOperation.Insert -> it.parentId
          is ViewOperation.Remove -> it.parentId
        }
      }
      operationsByParent.forEach forEachParent@ { (parentId, operations) ->
        // Prefer the node's tracked view (this allows ZynthRootView to mount content into a dedicated container).
        val parentView = (nodes.get(parentId)?.view as? ViewGroup)
          ?: (if (parentId == root.rootId) root else null)

        if (parentView == null) {
          operations.filterIsInstance<ViewOperation.Remove>().forEach { op ->
            detachChildView(parentId, op.node)
          }
          return@forEachParent
        }

        parentView.suppressLayoutCompat(true)
        try {
          operations.forEach { operation ->
            when (operation) {
              is ViewOperation.Insert -> {
                val childNode = nodes.get(operation.childId)
                if (childNode == null) {
                  Log.w(
                    "ZynthUI",
                    "processPendingViewOperations: insert node ${operation.childId} missing for parent $parentId",
                  )
                  return@forEach
                }
                val childView = childNode.view
                (childView.parent as? ViewGroup)?.removeView(childView)
                val safeIndex = operation.index.coerceIn(0, parentView.childCount)
                parentView.addView(childView, safeIndex)
                if (childNode.mountAwaitingFirstProps && childNode.mountStartTimeMs == 0L) {
                  childNode.mountStartTimeMs = android.os.SystemClock.elapsedRealtime()
                }
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
                removeNodeRecursive(operation.node.id)
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
      
      val elapsed = android.os.SystemClock.elapsedRealtime() - startTime
      if (elapsed > 5) {
        // Log.w("ZynthPerf", "⚠️ processPendingViewOperations: ${elapsed}ms for $initialCount ops")
      }
    }
  }

  // ==================== Flush & Layout Coordination ====================

  internal fun flush() = onMain {
    dirty = true
    if (!hasDispatchedFirstFrame && firstFrameStartTimeMs == null) {
      firstFrameStartTimeMs = SystemClock.elapsedRealtime()
    }
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
    frameScheduler.scheduleFlush frameFlush@ {
      flushCoalesceScheduled = false
      val dispatchPriority = pendingFlushPriority
      pendingFlushPriority = FlushPriority.NORMAL
      if (layoutTransactionActive) {
        scheduleFlush(dispatchPriority)
        return@frameFlush
      }
      if (dirty) {
        performFlush()
      }
    }
  }

  internal fun performFlush() {
    if (layoutTransactionActive) return
    
    val flushStartTime = android.os.SystemClock.elapsedRealtime()
    val initialViewOps = pendingViewOperations.size
    val initialNativeOps = pendingNativeOperations.size
    var totalNativeOpsTime = 0L
    var totalViewOpsTime = 0L
    var totalTextRebuildTime = 0L
    var totalLayoutCalcTime = 0L
    var totalApplyLayoutTime = 0L
    var iterationCapHit = false
    var shouldContinue: Boolean
    var loopCount = 0

    trace("flush_start") {
      "native=$initialNativeOps view=$initialViewOps dirty=$dirty text=${pendingTextRebuild.size}"
    }
    
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
        loopCount++
        trace("flush_iteration_start") {
          "loop=$loopCount nativeQueued=${pendingNativeOperations.size} viewQueued=${pendingViewOperations.size}"
        }
        dirty = false

        PerformanceProfiler.recordLayoutStart()
        
        val nativeOpsStart = android.os.SystemClock.elapsedRealtime()
        processPendingNativeOperations()
        val nativeOpsTime = android.os.SystemClock.elapsedRealtime() - nativeOpsStart
        totalNativeOpsTime += nativeOpsTime
        
        val viewOpsStart = android.os.SystemClock.elapsedRealtime()
        processPendingViewOperations()
        val viewOpsTime = android.os.SystemClock.elapsedRealtime() - viewOpsStart
        totalViewOpsTime += viewOpsTime
        
        val textRebuildStart = android.os.SystemClock.elapsedRealtime()
        drainPendingTextRebuilds()
        val textRebuildTime = android.os.SystemClock.elapsedRealtime() - textRebuildStart
        totalTextRebuildTime += textRebuildTime

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
        
        val layoutCalcTime = android.os.SystemClock.elapsedRealtime() - textRebuildStart - textRebuildTime
        totalLayoutCalcTime += layoutCalcTime

        PerformanceProfiler.recordRenderStart()
        
        val applyLayoutStart = android.os.SystemClock.elapsedRealtime()

        // Get all frames at once from the engine (single batch lookup)
        val allFrames = engine.getAllFrames()
        val stickyNodesForRelayout = mutableSetOf<Int>()
        val stickyFramesUsedThisFrame = mutableSetOf<Int>()

        // Single iteration: Apply frames, update layout params, measure, visibility
        for (i in 0 until nodes.size()) {
          val node = nodes.valueAt(i)
          if (isVirtualTextNode(node)) continue

          val rawFrame = allFrames[node.id] ?: Rect(0, 0, 0, 0)
          val rawWidth = rawFrame.right - rawFrame.left
          val rawHeight = rawFrame.bottom - rawFrame.top
          val previous = previousFrames.get(node.id)
          val previousWidth = previous?.let { it.right - it.left } ?: 0
          val previousHeight = previous?.let { it.bottom - it.top } ?: 0
          
          // Sticky frame logic: reuse previous frame if raw frame is zero but previous had size
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
                "ZynthUI",
                "[layout] node=${node.id} type=${node.type} parentType=$parentType raw=(${rawFrame.left},${rawFrame.top},${rawFrame.right},${rawFrame.bottom}) applied=(${appliedFrame.left},${appliedFrame.top},${appliedFrame.right},${appliedFrame.bottom}) children=$childCount reused=$shouldReusePrevious"
              )
            }
          }

          val width = (appliedFrame.right - appliedFrame.left).coerceAtLeast(0)
          val height = (appliedFrame.bottom - appliedFrame.top).coerceAtLeast(0)

          // Update layout params if changed
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

          // Ensure measured dimensions stay in sync (batch with frame changes detection)
          val cachedFrame = node.measuredFrame
          val frameChanged = cachedFrame == null ||
            cachedFrame.left != appliedFrame.left ||
            cachedFrame.top != appliedFrame.top ||
            cachedFrame.right != appliedFrame.right ||
            cachedFrame.bottom != appliedFrame.bottom

          if (frameChanged) {
            val targetWidthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
            val targetHeightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
            if (
              node.view.measuredWidth != width ||
              node.view.measuredHeight != height
            ) {
              node.view.measure(targetWidthSpec, targetHeightSpec)
            }
            // Cache the frame for future comparisons
            node.measuredFrame = appliedFrame
          }

          // Apply layout with the final frame
          node.view.layout(appliedFrame.left, appliedFrame.top, appliedFrame.right, appliedFrame.bottom)
          if (node.type != TEXT_TYPE) {
            node.label?.layout(0, 0, width, height)
          }

          TransformOriginApplier.apply(node.view, node.transformOrigin, width, height)

          if (frameChanged) {
            maybeStartLayoutTransition(node, previous, appliedFrame, width, height)
          }

          // Update visibility based on frame size (combined with frame application)
          val hasSize = width > 0 && height > 0
          val hideForMount = node.mountAwaitingFirstProps &&
            !node.mountHasVisualProps &&
            node.mountStartTimeMs > 0L &&
            (android.os.SystemClock.elapsedRealtime() - node.mountStartTimeMs) < MOUNT_HIDE_TIMEOUT_MS
          if (!hideForMount && node.mountAwaitingFirstProps && node.mountStartTimeMs > 0L) {
            val elapsed = android.os.SystemClock.elapsedRealtime() - node.mountStartTimeMs
            if (elapsed >= MOUNT_HIDE_TIMEOUT_MS) {
              node.mountHasVisualProps = true
              node.mountAwaitingFirstProps = false
            }
          }
          val shouldBeVisible = hasSize && !hideForMount
          node.view.visibility = if (shouldBeVisible) View.VISIBLE else View.INVISIBLE
          if (shouldBeVisible && node.mountAwaitingFirstProps) {
            node.mountAwaitingFirstProps = false
          }
          if (hasSize) {
            node.label?.alpha = 1f
          }
        }
        
        stickyFrameCarryover.clear()
        stickyFrameCarryover.addAll(stickyFramesUsedThisFrame)
        if (stickyNodesForRelayout.isNotEmpty()) {
          stickyRelayoutNodes.addAll(stickyNodesForRelayout)
        }
        
        val applyLayoutTime = android.os.SystemClock.elapsedRealtime() - applyLayoutStart
        totalApplyLayoutTime += applyLayoutTime
        
        PerformanceProfiler.recordRenderEnd()
        
        // Log performance if this iteration was slow
        val iterationTime = nativeOpsTime + viewOpsTime + textRebuildTime + layoutCalcTime + applyLayoutTime
        if (routerPerfLoggingEnabled && iterationTime >= FLUSH_ITERATION_WARN_THRESHOLD_MS) {
          Log.w(
            "ZynthPerf",
            "Surface $surfaceId flush iteration #$loopCount took ${iterationTime}ms " +
              "(native=${nativeOpsTime}ms, view=${viewOpsTime}ms, text=${textRebuildTime}ms, " +
              "layout=${layoutCalcTime}ms, apply=${applyLayoutTime}ms)"
          )
        }

        if (iterationTime > 16) {
          // Log.w("ZynthPerf", """
          //   🔥 SLOW FLUSH ITERATION #$loopCount: ${iterationTime}ms
          //     - Native ops: ${nativeOpsTime}ms
          //     - View ops: ${viewOpsTime}ms  
          //     - Text rebuild: ${textRebuildTime}ms
          //     - Layout calc: ${layoutCalcTime}ms
          //     - Apply layout: ${applyLayoutTime}ms (${nodes.size()} nodes)
          // """.trimIndent())
        }
        
        shouldContinue = dirty || pendingNativeOperations.isNotEmpty() || pendingViewOperations.isNotEmpty()
        trace("flush_iteration_end") {
          "loop=$loopCount continue=$shouldContinue nativeTime=${nativeOpsTime}ms viewTime=${viewOpsTime}ms textTime=${textRebuildTime}ms layoutTime=${layoutCalcTime}ms applyTime=${applyLayoutTime}ms"
        }
        if (shouldContinue && loopCount >= MAX_FLUSH_ITERATIONS) {
          iterationCapHit = true
          dirty = true
          break
        }
      } while (shouldContinue)
      maybeDispatchFirstFrame()
      if (stickyRelayoutNodes.isNotEmpty()) {
        stickyRelayoutNodes.forEach { nodeId ->
          val node = nodes.get(nodeId)
          // Don't mark TEXT nodes dirty - they have measure functions
          if (node?.type != "text") {
            engine.markDirty(nodeId)
          }
        }
      }
      
      // Log overall flush performance
      val totalFlushTime = android.os.SystemClock.elapsedRealtime() - flushStartTime
      totalFlushes++
      this.totalFlushTime += totalFlushTime
      
      if (totalFlushTime > 16) {
        slowFlushCount++
        val avgFlushTime = if (totalFlushes > 0) this.totalFlushTime / totalFlushes else 0
        Log.e("ZynthPerf", """
          ⚠️ SLOW FLUSH: ${totalFlushTime}ms ($loopCount iterations)
            Initial ops: view=$initialViewOps native=$initialNativeOps
            Total nodes: ${nodes.size()}
            Slow flush rate: ${slowFlushCount}/${totalFlushes} (${slowFlushCount * 100 / totalFlushes}%)
            Avg flush time: ${avgFlushTime}ms
        """.trimIndent())
        
        // Extra warning if node count is suspiciously high
        if (nodes.size() > 400) {
          Log.e("ZynthPerf", "🚨 NODE COUNT EXPLOSION: ${nodes.size()} nodes (expected <100 for virtualized list)")
        }
      }
      reportMetrics(
        FlushMetrics(
          surfaceId = surfaceId,
          totalDurationMs = totalFlushTime,
          iterationCount = loopCount,
          initialNativeOps = initialNativeOps,
          initialViewOps = initialViewOps,
          totalNativeTimeMs = totalNativeOpsTime,
          totalViewTimeMs = totalViewOpsTime,
          totalTextTimeMs = totalTextRebuildTime,
          totalLayoutTimeMs = totalLayoutCalcTime,
          totalApplyTimeMs = totalApplyLayoutTime,
          iterationCapHit = iterationCapHit,
          firstFrameDelayMs = lastFirstFrameDelayMs,
        ),
      )

    } finally {
      root.suppressLayoutCompat(false)
      layoutTransactionActive = false
      val hasPendingOperations = dirty || pendingNativeOperations.isNotEmpty() || pendingViewOperations.isNotEmpty()
      val flushDuration = android.os.SystemClock.elapsedRealtime() - flushStartTime
      trace("flush_complete") {
        "duration=${flushDuration}ms iterations=$loopCount pendingNative=${pendingNativeOperations.size} pendingView=${pendingViewOperations.size} dirty=$dirty"
      }
      frameCommitCoordinator.onFlushComplete(hasPendingOperations)
      when {
        stickyRelayoutNodes.isNotEmpty() -> scheduleFlush(FlushPriority.HIGH)
        iterationCapHit -> scheduleFlush(FlushPriority.HIGH)
        hasPendingOperations -> scheduleFlush()
      }
    }
  }

  private fun maybeStartLayoutTransition(
    node: ZynthUIManager.Node,
    previous: Rect?,
    appliedFrame: Rect,
    width: Int,
    height: Int,
  ) {
    val transition = node.layoutTransition ?: return
    if (transition.type != "linear") return
    if (previous == null) return
    val prevWidth = previous.right - previous.left
    val prevHeight = previous.bottom - previous.top
    if (prevWidth <= 0 || prevHeight <= 0 || width <= 0 || height <= 0) return

    val prevCenterX = previous.left + prevWidth / 2f
    val prevCenterY = previous.top + prevHeight / 2f
    val newCenterX = appliedFrame.left + width / 2f
    val newCenterY = appliedFrame.top + height / 2f

    val deltaX = prevCenterX - newCenterX
    val deltaY = prevCenterY - newCenterY
    val scaleX = prevWidth.toFloat() / width.toFloat()
    val scaleY = prevHeight.toFloat() / height.toFloat()

    if (abs(deltaX) < 0.5f && abs(deltaY) < 0.5f && abs(scaleX - 1f) < 0.01f && abs(scaleY - 1f) < 0.01f) {
      return
    }

    node.layoutAnimator?.cancel()
    node.layoutAnimator = null

    val view = node.view
    view.translationX = deltaX
    view.translationY = deltaY
    view.scaleX = scaleX
    view.scaleY = scaleY

    val duration = transition.durationMs.coerceAtLeast(0L)
    val delay = transition.delayMs.coerceAtLeast(0L)
    val animator = view.animate()
      .translationX(0f)
      .translationY(0f)
      .scaleX(1f)
      .scaleY(1f)
      .setStartDelay(delay)
      .setDuration(duration)
      .setInterpolator(transition.easing.toInterpolator())
      .withEndAction { node.layoutAnimator = null }

    node.layoutAnimator = animator
    animator.start()
  }

  // ==================== Layout Helpers ====================

  private fun drainPendingTextRebuilds() {
    if (pendingTextRebuild.isEmpty()) return
    
    val rebuildStart = android.os.SystemClock.elapsedRealtime()
    
    val toProcess = pendingTextRebuild.toList()
    pendingTextRebuild.clear()
    toProcess.forEach { nodeId ->
      val node = nodes.get(nodeId) ?: return@forEach
      if (node.type != TEXT_TYPE) return@forEach
      val result = textComposer.compose(node)
      node.cachedText = result.text.toString()
      val textView = node.view as? TextView
      textView?.let {
        it.text = result.text
        applyRootTextStyle(it, result.effectiveStyle ?: node.textStyle)
        // Ensure TextView internal layout is invalidated so next measure() uses new content
        it.requestLayout()
        it.forceLayout()
      }
      // Mark Yoga node dirty so it re-measures with new text content
      // This is critical for nested text changes (e.g., icon fonts loading)
      try {
        engine.markDirty(nodeId)
      } catch (e: Throwable) {
        // Ignore - markDirty may fail for non-leaf nodes
      }
      // Also mark layout as dirty to trigger a re-layout pass
      dirty = true
    }
    
    val rebuildTime = android.os.SystemClock.elapsedRealtime() - rebuildStart
    if (rebuildTime > 5) {
      // Log.w("ZynthPerf", "⚠️ drainPendingTextRebuilds: ${rebuildTime}ms for $count text nodes")
    }
  }

  private fun applyRootTextStyle(textView: TextView, style: TextStyleAttributes?) {
    if (style == null) return
    style.textAlign?.let { align ->
      val gravity = when (align.lowercase()) {
        "center" -> android.view.Gravity.CENTER_HORIZONTAL
        "right", "end" -> android.view.Gravity.END
        "justify" -> android.view.Gravity.FILL_HORIZONTAL
        else -> android.view.Gravity.START
      }
      textView.gravity = gravity or (textView.gravity and android.view.Gravity.VERTICAL_GRAVITY_MASK)
    }

    style.lineHeight?.let { lh ->
      val fm = textView.paint.fontMetricsInt
      val current = (fm.descent - fm.ascent).toFloat().coerceAtLeast(1f)
      val add = (lh - current).coerceAtLeast(0f)
      textView.setLineSpacing(add, 1f)
    } ?: style.lineSpacing?.let { spacing ->
      textView.setLineSpacing(spacing, 1f)
    }

    style.letterSpacing?.let { spacingPx ->
      val baseSize = (style.fontSize ?: textView.textSize).coerceAtLeast(1f)
      textView.letterSpacing = spacingPx / baseSize
    }

    style.minimumFontScale?.let { scale ->
      if (scale > 0f) {
        val sizePx = (style.fontSize ?: textView.textSize).toInt()
        val minSize = (sizePx * scale).toInt().coerceAtLeast(1)
        try {
          textView.setAutoSizeTextTypeUniformWithConfiguration(minSize, sizePx, 1, android.util.TypedValue.COMPLEX_UNIT_PX)
        } catch (_: Throwable) {
          // Autosize not available on this platform; skip gracefully
        }
      }
    }
  }

  private fun detachChildView(parentId: Int, childNode: ZynthUIManager.Node) {
    val expectedParentView = (nodes.get(parentId)?.view as? ViewGroup)
      ?: (if (parentId == root.rootId) root else null)
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
        "ZynthUI",
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

  private inline fun trace(event: String, detailsBuilder: () -> String) {
    val tracer = visualTracer ?: return
    tracer.trace(event, detailsBuilder())
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

  private fun maybeDispatchFirstFrame() {
    if (hasDispatchedFirstFrame) return
    val callback = firstFrameCallback ?: return
    val hasRenderableChildren = nodes.size() > 1 && root.contentView.childCount > 0
    if (!hasRenderableChildren) return
    hasDispatchedFirstFrame = true
    firstFrameCallback = null
    firstFrameStartTimeMs?.let {
      lastFirstFrameDelayMs = SystemClock.elapsedRealtime() - it
    }
    firstFrameStartTimeMs = null
    callback()
  }

  data class FlushMetrics(
    val surfaceId: Int,
    val totalDurationMs: Long,
    val iterationCount: Int,
    val initialNativeOps: Int,
    val initialViewOps: Int,
    val totalNativeTimeMs: Long,
    val totalViewTimeMs: Long,
    val totalTextTimeMs: Long,
    val totalLayoutTimeMs: Long,
    val totalApplyTimeMs: Long,
    val iterationCapHit: Boolean,
    val firstFrameDelayMs: Long?,
  )
}
