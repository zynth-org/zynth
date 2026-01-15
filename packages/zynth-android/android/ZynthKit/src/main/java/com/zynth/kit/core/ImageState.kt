package com.zynth.kit.core

import java.util.concurrent.Future

/**
 * Image node state for tracking image loading, dimensions, and handlers.
 * Used by both core and image component package.
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
)
