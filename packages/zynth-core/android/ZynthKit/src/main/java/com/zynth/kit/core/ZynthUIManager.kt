package com.zynth.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.zynth.kit.layout.ZynthYogaLayout
import com.zynth.kit.runtime.JSBridge
import kotlin.math.max

class ZynthUIManager(private val rootView: ZynthRootView) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var nextId = 1
  private val nodes = HashMap<Int, View>()
  private val parents = HashMap<Int, Int>()
  private val yoga = ZynthYogaLayout()
  private val backgrounds = HashMap<Int, GradientDrawable>()
  private val borderWidths = HashMap<Int, Int>()
  private val borderColors = HashMap<Int, Int>()
  private val pointerEvents = HashMap<Int, String>()
  private val pressNodes = HashSet<Int>()
  private val longPressNodes = HashSet<Int>()
  private val doublePressNodes = HashSet<Int>()
  private val activePressNodes = HashSet<Int>()
  private val longPressFired = HashSet<Int>()
  private val longPressDurations = HashMap<Int, Double>()
  private val doublePressWindows = HashMap<Int, Double>()
  private val lastPressTimestamps = HashMap<Int, Double>()
  private val pressLocalPoints = HashMap<Int, Pair<Float, Float>>()
  private val pressScreenPoints = HashMap<Int, Pair<Float, Float>>()
  private val longPressRunnables = HashMap<Int, Runnable>()
  private val touchListeners = HashMap<Int, View.OnTouchListener>()
  private val layoutNodes = HashSet<Int>()
  private val layoutPending = HashSet<Int>()
  private val layoutFrames = HashMap<Int, android.graphics.Rect>()
  private var choreographer: Choreographer? = null
  private var frameCallbackPosted = false
  private var needsLayout = false
  private var frameInProgress = false
  private var budgetOverruns = 0
  private var lastLayoutMs = 0.0
  private var lastFrameMs = 0.0
  private var frameProfiler: ((Double, Double, Boolean, Int) -> Unit)? = null
  private val frameCallback = Choreographer.FrameCallback { handleFrame() }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }

  fun setFrameProfiler(profiler: ((frameMs: Double, layoutMs: Double, overBudget: Boolean, nodeCount: Int) -> Unit)?) {
    frameProfiler = profiler
  }

  fun createNode(type: String): Int {
    val id = nextId++
    val view = if (type == "text") {
      TextView(rootView.context).apply { text = "" }
    } else {
      ZynthLayoutView(rootView.context)
    }
    nodes[id] = view
    pointerEvents[id] = "auto"
    yoga.ensureNode(id, view)
    return id
  }

  fun createNodeWithId(type: String, id: Int) {
    val resolvedId = if (id > 0) id else nextId++
    if (resolvedId >= nextId) {
      nextId = resolvedId + 1
    }
    val view = if (type == "text") {
      TextView(rootView.context).apply { text = "" }
    } else {
      ZynthLayoutView(rootView.context)
    }
    nodes[resolvedId] = view
    pointerEvents[resolvedId] = "auto"
    yoga.ensureNode(resolvedId, view)
  }

  fun setProp(id: Int, name: String, value: String?) {
    val view = nodes[id] ?: return
    if (name == "backgroundColor") {
      parseColor(value)?.let { color ->
        val drawable = backgrounds.getOrPut(id) { GradientDrawable() }
        drawable.setColor(color)
        runOnMain { view.background = drawable }
      }
      return
    }
    if (name == "color" && view is TextView) {
      parseColor(value)?.let { color ->
        runOnMain { view.setTextColor(color) }
      }
      return
    }
    if (name == "borderRadius") {
      val radius = value?.toFloatOrNull() ?: return
      val drawable = backgrounds.getOrPut(id) { GradientDrawable() }
      drawable.cornerRadius = radius
      runOnMain { view.background = drawable }
      return
    }
    if (name == "borderWidth") {
      val width = value?.toFloatOrNull() ?: return
      val drawable = backgrounds.getOrPut(id) { GradientDrawable() }
      val color = borderColors[id] ?: Color.TRANSPARENT
      val widthPx = width.toInt()
      borderWidths[id] = widthPx
      drawable.setStroke(widthPx, color)
      runOnMain { view.background = drawable }
      return
    }
    if (name == "borderColor") {
      val color = parseColor(value) ?: return
      val drawable = backgrounds.getOrPut(id) { GradientDrawable() }
      borderColors[id] = color
      val widthPx = borderWidths[id] ?: 0
      drawable.setStroke(widthPx, color)
      runOnMain { view.background = drawable }
      return
    }
    if (name == "pointerEvents") {
      if (value.isNullOrBlank()) {
        pointerEvents.remove(id)
      } else {
        pointerEvents[id] = value
      }
      updateInteractionState(id)
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
      return
    }
    if (name == "zIndex") {
      val z = value?.toFloatOrNull() ?: return
      runOnMain { view.translationZ = z }
      return
    }
    if (name == "elevation") {
      val elevation = value?.toFloatOrNull() ?: return
      runOnMain { view.elevation = elevation }
      return
    }
    if (view is TextView && name == "fontSize") {
      val size = value?.toFloatOrNull() ?: return
      runOnMain { view.textSize = size }
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
      return
    }
    if (view is TextView && name == "fontStyle") {
      val style = if (value == "italic") Typeface.ITALIC else Typeface.NORMAL
      runOnMain { view.setTypeface(view.typeface, style) }
      return
    }
    if (view is TextView && name == "fontFamily") {
      val family = value ?: return
      runOnMain { view.typeface = Typeface.create(family, view.typeface?.style ?: Typeface.NORMAL) }
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
      return
    }
    if (view is TextView && name == "letterSpacing") {
      val spacing = value?.toFloatOrNull() ?: return
      runOnMain { view.letterSpacing = spacing }
      return
    }
    if (name == "width") {
      yoga.setStyle(id, "width", value)
      return
    }
    if (name == "height") {
      yoga.setStyle(id, "height", value)
      return
    }
    if (name == "flexDirection") {
      yoga.setStyle(id, "flexDirection", value)
      return
    }
    yoga.setStyle(id, name, value)
  }

  fun setText(id: Int, text: String) {
    val view = nodes[id]
    if (view is TextView) {
      runOnMain { view.text = text }
      yoga.markDirty(id)
      val parentId = parents[id]
      if (parentId != null) {
        val parent = nodes[parentId]
        if (parent is TextView) {
          runOnMain { parent.text = text }
          yoga.markDirty(parentId)
        }
      }
    }
  }

  fun insertChild(parentId: Int, childId: Int, index: Int) {
    val child = nodes[childId] ?: return
    val parent = if (parentId == 0) rootView else nodes[parentId]
    parents[childId] = parentId
    if (parent is TextView && child is TextView) {
      runOnMain { parent.text = child.text }
      yoga.markDirty(parentId)
      return
    }
    val group = parent as? ViewGroup
    if (group == null) {
      yoga.insertChild(parentId, childId, index)
      return
    }
    runOnMain {
      val targetIndex = index.coerceIn(0, group.childCount)
      group.addView(child, targetIndex)
    }
    yoga.insertChild(parentId, childId, index)
  }

  fun removeChild(parentId: Int, childId: Int) {
    val child = nodes[childId] ?: return
    parents.remove(childId)
    runOnMain { (child.parent as? ViewGroup)?.removeView(child) }
    yoga.removeChild(parentId, childId)
  }

  fun setHandler(id: Int, name: String) {
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

  fun applyBatch(json: String) {
    json.length
  }

  fun setSurface(surfaceId: Int) {
    surfaceId
  }

  fun flush() {
    requestLayout()
  }

  private fun requestLayout() {
    runOnMain {
      ensureChoreographer()
      needsLayout = true
      if (!frameCallbackPosted) {
        frameCallbackPosted = true
        choreographer?.postFrameCallback(frameCallback)
      }
    }
  }

  private fun ensureChoreographer() {
    if (choreographer == null) {
      choreographer = Choreographer.getInstance()
    }
  }

  private fun handleFrame() {
    if (frameInProgress) return
    if (!needsLayout) {
      frameCallbackPosted = false
      return
    }
    frameInProgress = true
    needsLayout = false

    val startNs = System.nanoTime()
    performLayout()
    val endNs = System.nanoTime()
    lastFrameMs = (endNs - startNs) / 1_000_000.0
    lastLayoutMs = lastFrameMs

    val overBudget = lastFrameMs > 14.0
    if (overBudget) {
      budgetOverruns += 1
      Log.w(
        "ZynthUI",
        "frame over budget %.2fms (budget %.2fms, nodes %d, overruns %d)".format(
          lastFrameMs,
          14.0,
          yoga.nodeCount(),
          budgetOverruns
        )
      )
    }
    frameProfiler?.invoke(lastFrameMs, lastLayoutMs, overBudget, yoga.nodeCount())
    dispatchLayoutEvents()
    frameInProgress = false
    if (needsLayout) {
      frameCallbackPosted = true
      choreographer?.postFrameCallback(frameCallback)
    } else {
      frameCallbackPosted = false
    }
  }

  private fun performLayout() {
    val width = rootView.width.takeIf { it > 0 } ?: rootView.measuredWidth
    val height = rootView.height.takeIf { it > 0 } ?: rootView.measuredHeight
    yoga.layout(width, height, nodes)
  }

  private fun pointerModeFor(id: Int): String {
    return pointerEvents[id] ?: "auto"
  }

  private fun updateInteractionState(id: Int) {
    val view = nodes[id] ?: return
    val mode = pointerModeFor(id)
    val hasPress = pressNodes.contains(id)
    val enableInteraction = mode != "none"
    val enablePress = hasPress && mode != "none" && mode != "box-none"
    runOnMain {
      view.isEnabled = enableInteraction
      view.isClickable = enablePress
      view.isLongClickable = enablePress
    }
  }

  private fun attachTouchListener(id: Int) {
    val view = nodes[id] ?: return
    if (touchListeners.containsKey(id)) return
    val listener = View.OnTouchListener { v, event ->
      handleTouchEvent(id, v, event)
    }
    touchListeners[id] = listener
    runOnMain { view.setOnTouchListener(listener) }
  }

  private fun handleTouchEvent(id: Int, view: View, event: MotionEvent): Boolean {
    val mode = pointerModeFor(id)
    if (mode == "none" || mode == "box-none") {
      return false
    }
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        activePressNodes.add(id)
        longPressFired.remove(id)
        pressLocalPoints[id] = event.x to event.y
        pressScreenPoints[id] = event.rawX to event.rawY
        scheduleLongPress(id)
        JSBridge.invokePressEvent(
          id,
          "onPressIn",
          event.x.toDouble(),
          event.y.toDouble(),
          event.rawX.toDouble(),
          event.rawY.toDouble(),
          -1.0,
          System.currentTimeMillis().toDouble(),
          false
        )
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        pressLocalPoints[id] = event.x to event.y
        pressScreenPoints[id] = event.rawX to event.rawY
        return true
      }
      MotionEvent.ACTION_UP -> {
        cancelLongPress(id)
        activePressNodes.remove(id)
        val inside = event.x >= 0 && event.y >= 0 &&
          event.x <= view.width && event.y <= view.height
        val longPressed = longPressFired.contains(id)
        if (inside && !longPressed) {
          JSBridge.invokePressEvent(
            id,
            "onPress",
            event.x.toDouble(),
            event.y.toDouble(),
            event.rawX.toDouble(),
            event.rawY.toDouble(),
            -1.0,
            System.currentTimeMillis().toDouble(),
            false
          )
          maybeDispatchDoublePress(id, event)
        }
        JSBridge.invokePressEvent(
          id,
          "onPressOut",
          event.x.toDouble(),
          event.y.toDouble(),
          event.rawX.toDouble(),
          event.rawY.toDouble(),
          -1.0,
          System.currentTimeMillis().toDouble(),
          !inside
        )
        return true
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelLongPress(id)
        activePressNodes.remove(id)
        JSBridge.invokePressEvent(
          id,
          "onPressOut",
          event.x.toDouble(),
          event.y.toDouble(),
          event.rawX.toDouble(),
          event.rawY.toDouble(),
          -1.0,
          System.currentTimeMillis().toDouble(),
          true
        )
        return true
      }
    }
    return false
  }

  private fun longPressDurationFor(id: Int): Double {
    val duration = longPressDurations[id] ?: 500.0
    return max(0.0, duration)
  }

  private fun doublePressWindowFor(id: Int): Double {
    val window = doublePressWindows[id] ?: 250.0
    return max(0.0, window)
  }

  private fun scheduleLongPress(id: Int) {
    if (!longPressNodes.contains(id)) return
    cancelLongPress(id)
    val delayMs = longPressDurationFor(id)
    val runnable = Runnable {
      if (!activePressNodes.contains(id)) {
        cancelLongPress(id)
        return@Runnable
      }
      if (longPressFired.contains(id)) {
        cancelLongPress(id)
        return@Runnable
      }
      longPressFired.add(id)
      val local = pressLocalPoints[id] ?: (0f to 0f)
      val screen = pressScreenPoints[id] ?: (0f to 0f)
      JSBridge.invokePressEvent(
        id,
        "onLongPress",
        local.first.toDouble(),
        local.second.toDouble(),
        screen.first.toDouble(),
        screen.second.toDouble(),
        delayMs,
        System.currentTimeMillis().toDouble(),
        false
      )
      cancelLongPress(id)
    }
    longPressRunnables[id] = runnable
    mainHandler.postDelayed(runnable, delayMs.toLong())
  }

  private fun cancelLongPress(id: Int) {
    val runnable = longPressRunnables.remove(id)
    if (runnable != null) {
      mainHandler.removeCallbacks(runnable)
    }
  }

  private fun maybeDispatchDoublePress(id: Int, event: MotionEvent) {
    val timestamp = System.currentTimeMillis().toDouble()
    if (!doublePressNodes.contains(id)) {
      lastPressTimestamps[id] = timestamp
      return
    }
    val last = lastPressTimestamps[id]
    lastPressTimestamps[id] = timestamp
    if (last == null) return
    val delta = timestamp - last
    if (delta < 0 || delta > doublePressWindowFor(id)) return
    JSBridge.invokePressEvent(
      id,
      "onDoublePress",
      event.x.toDouble(),
      event.y.toDouble(),
      event.rawX.toDouble(),
      event.rawY.toDouble(),
      -1.0,
      timestamp,
      false
    )
  }

  private fun dispatchLayoutEvents() {
    if (layoutNodes.isEmpty()) return
    for (id in layoutNodes) {
      val view = nodes[id] ?: continue
      val frame = android.graphics.Rect(view.left, view.top, view.right, view.bottom)
      val previous = layoutFrames[id]
      val changed = previous == null || !previous.equals(frame)
      val force = layoutPending.contains(id)
      if (!force && !changed) continue
      layoutFrames[id] = frame
      layoutPending.remove(id)
      JSBridge.invokeLayoutEvent(
        id,
        frame.left.toDouble(),
        frame.top.toDouble(),
        frame.width().toDouble(),
        frame.height().toDouble()
      )
    }
  }

  private fun parseColor(value: String?): Int? {
    if (value.isNullOrBlank()) return null
    return try {
      Color.parseColor(value)
    } catch (_: Throwable) {
      null
    }
  }

}
