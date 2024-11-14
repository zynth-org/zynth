package com.rune.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.SparseArray
import android.view.Gravity
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Rect
import com.rune.kit.layout.Style
import com.rune.kit.runtime.JSBridge
import java.util.HashMap
import java.util.concurrent.CountDownLatch
import kotlin.math.roundToInt

class RuneUIManager(
  private val root: RuneRootView,
  private val engine: LayoutEngine,
  private val eventDispatcher: (Int, String) -> Unit = { _, _ -> },
  private val handlerListener: (Int, String, Long) -> Unit = { _, _, _ -> },
) : JSBridge.UIShim {
  data class Node(val id: Int, val type: String, val view: View, val label: TextView? = null)

  private val nodes = SparseArray<Node>()
  private val parents = HashMap<Int, Int?>()
  private val handler = Handler(Looper.getMainLooper())
  private val frameScheduler = FrameScheduler()
  private var nextId = root.rootId + 1
  @Volatile private var dirty = false
  private var lastRootWidth = -1
  private var lastRootHeight = -1

  init {
    parents[root.rootId] = null
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

  override fun createNode(type: String): Int = onMain {
    val id = nextId++
    val view: View
    val label: TextView?
    if (type == TEXT_TYPE) {
      val text = TextView(root.context)
      text.textSize = 16f
      text.setTextColor(Color.WHITE)
      text.gravity = Gravity.START
      Log.d("RuneUI", "Created text node $id")
      view = text
      label = text
    } else {
      view = FrameLayout(root.context)
      label = null
    }
  // Prevent pre-layout artifacts: reduce visibility impact by creating at 0x0 size
  // Avoid setting alpha to 0 for all nodes: only first layout will size them correctly.
  // Keep alpha at 1 to reduce flicker on subsequent conditional mounts.
  view.layoutParams = FrameLayout.LayoutParams(0, 0)
    // Don't set clickable by default - only when a handler is actually set
    view.isClickable = false
    val node = Node(id, type, view, label)
    nodes.put(id, node)
    parents[id] = null
    engine.createNode(id)
    // Default non-text views to full width unless overridden by explicit style
    if (label == null) {
      try {
        engine.setStyle(id, Style(widthPercent = 100f))
      } catch (_: Throwable) {
        // Defensive: style application should never crash creation
      }
    }
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
    }
    id
  }

  override fun setProp(nodeId: Int, name: String, jsonValue: String?) = onMain {
    Log.d("RuneUI", "setProp: nodeId=$nodeId name=$name jsonValue=$jsonValue")
    val valueJson = jsonValue ?: return@onMain
    // Resolve target even if the original node was merged/removed (e.g., text child inside Text)
    val direct = nodes.get(nodeId)
    val target = when {
      direct != null && (direct.label != null || direct.view is TextView) -> direct
      else -> resolveTextNode(nodeId) ?: direct
    } ?: run {
      Log.w("RuneUI", "setProp: nodeId=$nodeId not found and no text ancestor; skipping prop '$name'")
      return@onMain
    }
    when (name) {
      "style" -> {
        val style = Style.fromJson(valueJson)
        engine.setStyle(target.id, style)
        // If styling a merged child, clear any residual style on the original id in the layout engine
        if (target.id != nodeId) {
          engine.setStyle(nodeId, Style())
        }
        (target.label ?: target.view as? TextView)?.let { textView ->
          style.fontSize?.let { textView.textSize = it }
          style.color?.let { textView.setTextColor(it) }
          style.fontWeight?.let { weight ->
            val isBold = weight.equals("bold", ignoreCase = true) ||
              weight.toFloatOrNull()?.let { it >= 600f } == true
            textView.typeface = if (isBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
          }
        }
        style.backgroundColor?.let { target.view.setBackgroundColor(it) }
        style.borderRadius?.let { radius ->
          target.view.clipToOutline = true
          target.view.outlineProvider = RoundedOutline(radius)
        }
      }
      "onPress" -> {
        // onPress should be handled by the JavaScript bridge calling setHandler
        // This is just for logging
        Log.d("RuneUI", "onPress prop set for node $nodeId, expecting setHandler call")
      }
      else -> {
        Log.d("RuneUI", "Unhandled prop: $name = $valueJson")
      }
    }
    scheduleFlush()
  }

  override fun setText(nodeId: Int, text: String) = onMain {
    Log.d("RuneUI", "setText nodeId=$nodeId text='$text'")
    val target = resolveTextNode(nodeId)
    if (target == null) {
      Log.w("RuneUI", "setText: could not resolve target for nodeId=$nodeId")
    }
    when {
      target?.label != null -> {
        target.label.text = text
        Log.d("RuneUI", "Set text on label: ${target.label.text}")
      }
      target?.view is TextView -> {
        (target.view as TextView).text = text
        Log.d("RuneUI", "Set text on view: ${(target.view as TextView).text}")
      }
    }
    // Mark layout dirty so Yoga will re-measure intrinsic text size
    engine.markDirty(target?.id ?: nodeId)
    scheduleFlush()
  }

  override fun insertChild(parentId: Int, childId: Int, index: Int) = onMain {
    parents[childId] = parentId
    val parentNode = nodes.get(parentId)
    if (parentNode?.type == TEXT_TYPE) {
      // If parent is a text node, merge text content from child instead of nesting views
      val childNode = nodes.get(childId)
      if (childNode?.type == TEXT_TYPE && parentNode.label != null && childNode.label != null) {
        parentNode.label.text = childNode.label.text
        Log.d("RuneUI", "Merged text from child $childId into parent $parentId: '${childNode.label.text}'")
        // Remove the child node from nodes map so it doesn't get layout applied
        nodes.remove(childId)
        // IMPORTANT: Keep the parents[childId] mapping so future setText(childId, ...)
        // can resolve to this parent text node via resolveTextNode.
        // Remove from layout engine as well
        engine.removeNode(childId)
      }
      scheduleFlush()
      return@onMain
    }
    val parentView: View = if (parentId == root.rootId) {
      root
    } else {
      nodes.get(parentId)?.view ?: return@onMain
    }
    val childView = nodes.get(childId)?.view ?: return@onMain
    if (parentView is ViewGroup) {
      val safeIndex = index.coerceIn(0, parentView.childCount)
      parentView.addView(childView, safeIndex)
    }
    engine.insertChild(parentId, childId, index)
    scheduleFlush()
  }

  override fun removeChild(parentId: Int, childId: Int) = onMain {
    val parentNode = nodes.get(parentId)
    if (parentNode?.type == TEXT_TYPE) {
      engine.setMeasureHandler(childId, null)
      engine.removeNode(childId)
      scheduleFlush()
      // IMPORTANT: Do NOT remove the parent mapping here for merged text children.
      // During reconciliation, Solid may transiently remove/re-insert text nodes while
      // still issuing setText on the child id. Keeping the mapping ensures resolveTextNode
      // can still find the actual parent text node.
      return@onMain
    }
    // For non-text parents, clear mapping early
    parents[childId] = null
    val childView = nodes.get(childId)?.view ?: return@onMain
    (childView.parent as? ViewGroup)?.removeView(childView)
    engine.setMeasureHandler(childId, null)
    engine.removeNode(childId)
    scheduleFlush()
    parents.remove(childId)
  }

  override fun setHandler(nodeId: Int, event: String, handlerId: Long) = onMain {
    if (event == "onPress") {
      Log.d("RuneUI", "Setting onPress handler for node $nodeId")
      val node = nodes.get(nodeId)
      node?.view?.let { view ->
        // Make the view clickable when we set an onPress handler
        view.isClickable = true
        view.setOnClickListener {
          Log.d("RuneUI", "onPress triggered for node $nodeId")
          eventDispatcher(nodeId, event)
        }
      }
    }
    handlerListener(nodeId, event, handlerId)
  }

  override fun removeNode(nodeId: Int) = onMain {
    removeNodeRecursive(nodeId)
    scheduleFlush()
  }

  override fun flush() = onMain {
    // Defer to next frame to avoid mid-frame relayout flicker
    scheduleFlush()
  }

  private fun scheduleFlush() {
    dirty = true
    frameScheduler.scheduleFlush {
      if (dirty) {
        performFlush()
      }
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

  private fun performFlush() {
    if (root.width == 0 || root.height == 0) {
      handler.post { performFlush() }
      return
    }
    if (!dirty) return
    dirty = false
    engine.calculateLayout(root.width, root.height)
    for (i in 0 until nodes.size()) {
      val node = nodes.valueAt(i)
      val frame: Rect = engine.frame(node.id)
      Log.d("RuneUI", "Layout node ${node.id} (type=${node.type}) frame=$frame")
      node.view.layout(frame.left, frame.top, frame.right, frame.bottom)
  // View alpha remains 1 by default; avoid toggling visibility to reduce flicker
      // For text nodes, don't layout the label separately since view and label are the same object
      if (node.type != TEXT_TYPE) {
        node.label?.layout(0, 0, frame.right - frame.left, frame.bottom - frame.top)
      }
      node.label?.alpha = 1f
    }
  }

  private fun resolveTextNode(id: Int): Node? {
    var currentId: Int? = id
    while (currentId != null) {
      val node = nodes.get(currentId)
      if (node?.label != null || node?.view is TextView) return node
      currentId = parents[currentId]
    }
    return nodes.get(id)
  }

  private fun removeNodeRecursive(id: Int) {
    if (id == root.rootId) return
    val children = parents.entries.filter { it.value == id }.map { it.key }
    children.forEach { childId -> removeNodeRecursive(childId) }
    val node = nodes.get(id)
    if (node == null) {
      // Node may have been removed earlier (e.g., merged text child).
      // Ensure we still clear parent mapping to avoid stale references.
      parents.remove(id)
      return
    }
    
    // Clean up view: remove click listener and from parent
    node.view.setOnClickListener(null)
    node.view.isClickable = false
    (node.view.parent as? ViewGroup)?.removeView(node.view)
    
    // Clean up layout engine
    engine.setMeasureHandler(id, null)
    engine.removeNode(id)
    
    // Remove from our tracking maps
    nodes.remove(id)
    parents.remove(id)
  }

  companion object {
    private const val TEXT_TYPE = "text"
  }
}
