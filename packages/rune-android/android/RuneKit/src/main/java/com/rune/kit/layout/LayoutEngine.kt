package com.rune.kit.layout

import android.util.Log

data class Rect(val left: Int, val top: Int, val right: Int, val bottom: Int)

interface LayoutEngine {
  fun createNode(id: Int)
  fun removeNode(id: Int)
  fun insertChild(parent: Int, child: Int, index: Int)
  fun setStyle(id: Int, style: Style)
  fun calculateLayout(width: Int, height: Int)
  fun frame(id: Int): Rect
  fun setMeasureHandler(id: Int, handler: MeasureHandler?)
  /**
   * Mark the node as dirty so that Yoga will re-run its measure function.
   * Use this after content changes that affect intrinsic size (e.g., text updates).
   */
  fun markDirty(id: Int)
}

enum class MeasureMode { UNDEFINED, EXACTLY, AT_MOST }

data class MeasureInput(
  val width: Float,
  val widthMode: MeasureMode,
  val height: Float,
  val heightMode: MeasureMode,
)

typealias MeasureHandler = (MeasureInput) -> Pair<Float, Float>
