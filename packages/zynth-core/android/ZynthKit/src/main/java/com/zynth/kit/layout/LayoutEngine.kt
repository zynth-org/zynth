package com.zynth.kit.layout

data class Rect(val left: Int, val top: Int, val right: Int, val bottom: Int)

enum class MeasureMode { UNDEFINED, EXACTLY, AT_MOST }

data class MeasureInput(
  val width: Float,
  val widthMode: MeasureMode,
  val height: Float,
  val heightMode: MeasureMode,
)

typealias MeasureHandler = (MeasureInput) -> Pair<Float, Float>
