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
import java.util.HashMap
import java.util.concurrent.CountDownLatch
import kotlin.math.roundToInt

class RuneUIManager(
  private val root: RuneRootView,
  private val engine: LayoutEngine,
  private val eventDispatcher: (Int, String) -> Unit = { _, _ -> },
) {
  data class Node(val id: Int, val type: String, val view: View, val label: TextView? = null)

  private val nodes = SparseArray<Node>()
  private val parents = HashMap<Int, Int?>()
  private val handler = Handler(Looper.getMainLooper())
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

  fun createNode(type: String): Int = onMain {
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
    // Don't set clickable by default - only when a handler is actually set
    view.isClickable = false
    val node = Node(id, type, view, label)
    nodes.put(id, node)
    parents[id] = null
    engine.createNode(id)
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

  fun setProp(id: Int, name: String, valueJson: String) = onMain {
    Log.d("RuneUI", "setProp: id=$id name=$name valueJson=$valueJson")
    val node = nodes.get(id) ?: return@onMain
    val target = if (node.label != null || node.view is TextView) node else resolveTextNode(id) ?: node
    when (name) {
      "style" -> {
        val style = Style.fromJson(valueJson)
        engine.setStyle(target.id, style)
        if (target.id != id) {
          engine.setStyle(id, Style())
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
        Log.d("RuneUI", "onPress prop set for node $id, expecting setHandler call")
      }
      else -> {
        Log.d("RuneUI", "Unhandled prop: $name = $valueJson")
      }
    }
    scheduleFlush()
  }

  fun setText(id: Int, text: String) = onMain {
    Log.d("RuneUI", "setText id=$id text='$text'")
    val target = resolveTextNode(id)
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
    scheduleFlush()
  }

  fun insertChild(parent: Int, child: Int, index: Int) = onMain {
    parents[child] = parent
    val parentNode = nodes.get(parent)
    if (parentNode?.type == TEXT_TYPE) {
      // If parent is a text node, merge text content from child instead of nesting views
      val childNode = nodes.get(child)
      if (childNode?.type == TEXT_TYPE && parentNode.label != null && childNode.label != null) {
        parentNode.label.text = childNode.label.text
        Log.d("RuneUI", "Merged text from child $child into parent $parent: '${childNode.label.text}'")
        // Remove the child node from nodes map so it doesn't get layout applied
        nodes.remove(child)
        parents.remove(child)
        // Remove from layout engine as well
        engine.removeNode(child)
      }
      scheduleFlush()
      return@onMain
    }
    val parentView: View = if (parent == root.rootId) {
      root
    } else {
      nodes.get(parent)?.view ?: return@onMain
    }
    val childView = nodes.get(child)?.view ?: return@onMain
    if (parentView is ViewGroup) {
      val safeIndex = index.coerceIn(0, parentView.childCount)
      parentView.addView(childView, safeIndex)
    }
    engine.insertChild(parent, child, index)
    scheduleFlush()
  }

  fun removeChild(parent: Int, child: Int) = onMain {
    parents[child] = null
    val parentNode = nodes.get(parent)
    if (parentNode?.type == TEXT_TYPE) {
      engine.setMeasureHandler(child, null)
      engine.removeNode(child)
      scheduleFlush()
      parents.remove(child)
      return@onMain
    }
    val childView = nodes.get(child)?.view ?: return@onMain
    (childView.parent as? ViewGroup)?.removeView(childView)
    engine.setMeasureHandler(child, null)
    engine.removeNode(child)
    scheduleFlush()
    parents.remove(child)
  }

  fun setHandler(id: Int, name: String, fnRef: Long) = onMain {
    if (name == "onPress") {
      Log.d("RuneUI", "Setting onPress handler for node $id")
      val node = nodes.get(id)
      node?.view?.let { view ->
        // Make the view clickable when we set an onPress handler
        view.isClickable = true
        view.setOnClickListener {
          Log.d("RuneUI", "onPress triggered for node $id")
          eventDispatcher(id, name)
        }
      }
    }
  }

  fun flush() = onMain {
    performFlush()
  }

  private fun scheduleFlush() {
    dirty = true
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

  companion object {
    private const val TEXT_TYPE = "text"
  }
}
