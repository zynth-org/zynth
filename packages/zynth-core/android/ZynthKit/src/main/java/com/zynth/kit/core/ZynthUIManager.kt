package com.zynth.kit.core

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import com.zynth.kit.core.ZynthLayoutView
import android.view.Gravity
import android.widget.TextView
import com.zynth.kit.layout.ZynthYogaLayout

class ZynthUIManager(private val rootView: ZynthRootView) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var nextId = 1
  private val nodes = HashMap<Int, View>()
  private val parents = HashMap<Int, Int>()
  private val yoga = ZynthYogaLayout()
  private val backgrounds = HashMap<Int, GradientDrawable>()
  private val borderWidths = HashMap<Int, Int>()
  private val borderColors = HashMap<Int, Int>()

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }

  fun createNode(type: String): Int {
    val id = nextId++
    val view = if (type == "text") {
      TextView(rootView.context).apply { text = "" }
    } else {
      ZynthLayoutView(rootView.context)
    }
    nodes[id] = view
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

  fun setHandler(id: Int, name: String, handlerId: Long) {
    id
    name.length
    handlerId
  }

  fun applyBatch(json: String) {
    json.length
  }

  fun setSurface(surfaceId: Int) {
    surfaceId
  }

  fun flush() {
    val width = rootView.width.takeIf { it > 0 } ?: rootView.measuredWidth
    val height = rootView.height.takeIf { it > 0 } ?: rootView.measuredHeight
    yoga.layout(width, height, nodes)
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
