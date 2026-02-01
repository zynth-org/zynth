package com.zynth.screens

/**
 * Animation types for screen transitions.
 */
enum class ScreenAnimation {
  NONE,
  PUSH,
  MODAL,
  ZOOM,
  FADE;

  companion object {
    fun fromString(value: String?): ScreenAnimation {
      return when (value?.lowercase()) {
        "push", "slide" -> PUSH
        "modal", "sheet" -> MODAL
        "zoom", "scale" -> ZOOM
        "fade" -> FADE
        "none" -> NONE
        else -> PUSH
      }
    }
  }
}
