package com.rune.kit.layout

data class Rect(val left: Int, val top: Int, val right: Int, val bottom: Int)

interface LayoutEngine {
  fun createNode(id: Int)
  fun removeNode(id: Int)
  fun insertChild(parent: Int, child: Int, index: Int)
  fun setStyle(id: Int, style: Style)
  fun calculateLayout(width: Int, height: Int)
  /**
   * Calculate layout for a specific node tree (not necessarily the root).
   * Use this when you have isolated subtrees that aren't connected to the main root.
   */
  fun calculateLayoutForNode(nodeId: Int, width: Float, height: Float)
  fun frame(id: Int): Rect
  /**
   * Get all node frames at once after layout calculation.
   * This is more efficient than calling frame(id) repeatedly.
   * Returns a map of nodeId -> Rect for all nodes in the layout tree.
   */
  fun getAllFrames(): Map<Int, Rect>
  fun setMeasureHandler(id: Int, handler: MeasureHandler?)
  /**
   * Mark the node as dirty so that Yoga will re-run its measure function.
   * Use this after content changes that affect intrinsic size (e.g., text updates).
   */
  fun markDirty(id: Int)

  /**
   * Reset layout state by removing all tracked nodes except the root.
   * Implementations should also clear cached styles/measure handlers.
   */
  fun reset() {
    // Default no-op; implement when full reset is supported.
  }
}

enum class MeasureMode { UNDEFINED, EXACTLY, AT_MOST }

data class MeasureInput(
  val width: Float,
  val widthMode: MeasureMode,
  val height: Float,
  val heightMode: MeasureMode,
)

typealias MeasureHandler = (MeasureInput) -> Pair<Float, Float>
