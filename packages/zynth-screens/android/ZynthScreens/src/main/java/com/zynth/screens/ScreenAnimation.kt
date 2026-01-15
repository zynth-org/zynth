package com.zynth.screens

/**
 * Animation types for screen transitions
 */
enum class ScreenAnimation {
    /** No animation */
    NONE,
    
    /** Horizontal slide (iOS-style stack push/pop) */
    PUSH,

    /** Modal sheet style: slide up + fade */
    MODAL,
    
    /** Scale + fade (Android activity zoom) */
    ZOOM,
    
    /** Simple opacity fade */
    FADE;

    companion object {
        fun fromString(value: String?): ScreenAnimation {
            return when (value?.lowercase()) {
                "push", "slide" -> PUSH
                "modal", "sheet" -> MODAL
                "zoom", "scale" -> ZOOM
                "fade" -> FADE
                "none" -> NONE
                else -> PUSH // default
            }
        }
    }
}
