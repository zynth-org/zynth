package com.zynth.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import com.zynth.kit.layout.ZynthYogaLayout

class ZynthUIManager(internal val rootView: ZynthRootView) {
  internal val mainHandler = Handler(Looper.getMainLooper())
  internal var nextId = 1
  internal val nodes = HashMap<Int, View>()
  internal val parents = HashMap<Int, Int>()
  internal val nodeSurfaces = HashMap<Int, Int>()
  internal val surfaceRoots = HashMap<Int, ViewGroup>()
  internal val surfaceYoga = HashMap<Int, ZynthYogaLayout>()
  internal val dirtySurfaces = HashSet<Int>()
  internal val surfaceSizes = HashMap<Int, Pair<Int, Int>>()
  internal var activeSurfaceId = 0
  internal val backgrounds = HashMap<Int, GradientDrawable>()
  internal val borderWidths = HashMap<Int, Int>()
  internal val borderColors = HashMap<Int, Int>()
  internal val pointerEvents = HashMap<Int, String>()
  internal val pressNodes = HashSet<Int>()
  internal val longPressNodes = HashSet<Int>()
  internal val doublePressNodes = HashSet<Int>()
  internal val activePressNodes = HashSet<Int>()
  internal val longPressFired = HashSet<Int>()
  internal val longPressDurations = HashMap<Int, Double>()
  internal val doublePressWindows = HashMap<Int, Double>()
  internal val lastPressTimestamps = HashMap<Int, Double>()
  internal val pressLocalPoints = HashMap<Int, Pair<Float, Float>>()
  internal val pressScreenPoints = HashMap<Int, Pair<Float, Float>>()
  internal val longPressRunnables = HashMap<Int, Runnable>()
  internal val touchListeners = HashMap<Int, View.OnTouchListener>()
  internal val layoutNodes = HashSet<Int>()
  internal val layoutPending = HashSet<Int>()
  internal val layoutFrames = HashMap<Int, android.graphics.Rect>()
  internal var choreographer: Choreographer? = null
  internal var frameCallbackPosted = false
  internal var needsLayout = false
  internal var frameInProgress = false
  internal var didWarmup = false
  internal var budgetOverruns = 0
  internal var lastLayoutMs = 0.0
  internal var lastFrameMs = 0.0
  internal var frameProfiler: ((Double, Double, Boolean, Int) -> Unit)? = null
  internal val frameCallback = Choreographer.FrameCallback { handleFrame() }

  init {
    ensureSurface(0)
    rootView.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
      if (left != oldLeft || top != oldTop || right != oldRight || bottom != oldBottom) {
        markAllSurfacesDirty()
      }
    }
  }

  internal fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }

  fun setFrameProfiler(profiler: ((frameMs: Double, layoutMs: Double, overBudget: Boolean, nodeCount: Int) -> Unit)?) {
    setFrameProfilerInternal(profiler)
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
    nodeSurfaces[id] = activeSurfaceId
    yogaForSurface(activeSurfaceId).ensureNode(id, view)
    markSurfaceDirty(activeSurfaceId)
    return id
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
      yogaForNode(id).setStyle(id, "width", value)
      markSurfaceDirtyForNode(id)
      return
    }
    if (name == "height") {
      yogaForNode(id).setStyle(id, "height", value)
      markSurfaceDirtyForNode(id)
      return
    }
    if (name == "flexDirection") {
      yogaForNode(id).setStyle(id, "flexDirection", value)
      markSurfaceDirtyForNode(id)
      return
    }
    yogaForNode(id).setStyle(id, name, value)
    markSurfaceDirtyForNode(id)
  }

  fun setText(id: Int, text: String) {
    val view = nodes[id]
    if (view is TextView) {
      runOnMain { view.text = text }
      yogaForNode(id).markDirty(id)
      markSurfaceDirtyForNode(id)
      val parentId = parents[id]
      if (parentId != null) {
        val parent = nodes[parentId]
        if (parent is TextView) {
          runOnMain { parent.text = text }
          yogaForNode(parentId).markDirty(parentId)
          markSurfaceDirtyForNode(parentId)
        }
      }
    }
  }

  fun insertChild(parentId: Int, childId: Int, index: Int) {
    val child = nodes[childId] ?: return
    val surfaceId = if (parentId == 0) {
      activeSurfaceId
    } else {
      nodeSurfaces[parentId] ?: activeSurfaceId
    }
    val parent = if (parentId == 0) rootViewForSurface(surfaceId) else nodes[parentId]
    parents[childId] = parentId
    nodeSurfaces[childId] = surfaceId
    if (parent is TextView && child is TextView) {
      runOnMain { parent.text = child.text }
      yogaForNode(parentId).markDirty(parentId)
      markSurfaceDirty(surfaceId)
      return
    }
    val group = parent as? ViewGroup
    if (group == null) {
      yogaForSurface(surfaceId).insertChild(parentId, childId, index)
      return
    }
    runOnMain {
      val targetIndex = index.coerceIn(0, group.childCount)
      group.addView(child, targetIndex)
    }
    yogaForSurface(surfaceId).insertChild(parentId, childId, index)
    markSurfaceDirty(surfaceId)
  }

  fun removeChild(parentId: Int, childId: Int) {
    val child = nodes[childId] ?: return
    cleanupNode(childId)
    parents.remove(childId)
    runOnMain { (child.parent as? ViewGroup)?.removeView(child) }
    yogaForNode(childId).removeChild(parentId, childId)
    markSurfaceDirtyForNode(childId)
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
    ensureSurface(surfaceId)
    activeSurfaceId = surfaceId
    markSurfaceDirty(surfaceId)
  }

  fun flush() {
    markSurfaceDirty(activeSurfaceId)
    requestLayout()
  }

  private fun requestLayout() {
    requestLayoutInternal()
  }

  private fun ensureChoreographer() {
    ensureChoreographerInternal()
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
