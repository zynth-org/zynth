package com.zynth.components.image

/**
 * Image node state for tracking image loading, dimensions, and handlers.
 */
data class ImageState(
  var requestToken: String = "",
  var job: Any? = null,
  var tintColor: Int? = null,
  var isSystemSource: Boolean = false,
  var systemName: String? = null,
  var hasOnLoadHandler: Boolean = false,
  var hasOnErrorHandler: Boolean = false,
  var intrinsicWidth: Int = 0,
  var intrinsicHeight: Int = 0,
  var preferredWidth: Float? = null,
  var preferredHeight: Float? = null,
  var borderRadius: Float? = null,
)
