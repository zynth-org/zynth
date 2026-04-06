package com.zynth.components.statusbar

import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Color
import android.view.View
import android.view.Window
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

@Suppress("DEPRECATION")
class ZynthStatusBarView(context: Context) : View(context) {
  private var barStyle: String? = null
  private var hidden: Boolean? = null
  private var animated: Boolean = false
  private var backgroundColorValue: Int? = null
  private var showHideTransition: String? = null
  private var colorAnimator: ValueAnimator? = null
  private var currentWindow: Window? = null
  private var initialStatusBarColor: Int? = null
  private var initialLightStatusBars: Boolean? = null

  fun setAnimated(value: Boolean) {
    animated = value
  }

  fun setBarStyle(value: String?) {
    barStyle = value
    applyBarStyle()
  }

  fun setHidden(value: Boolean) {
    hidden = value
    applyHidden()
  }

  fun setShowHideTransition(value: String?) {
    showHideTransition = value
  }

  fun setBackgroundColorHex(value: String?) {
    backgroundColorValue = parseColor(value)
    applyBackgroundColor()
  }

  fun reset() {
    barStyle = null
    hidden = null
    animated = false
    backgroundColorValue = null
    showHideTransition = null
    colorAnimator?.cancel()
    colorAnimator = null
    val (window, controller) = resolveWindow() ?: return
    initialLightStatusBars?.let { controller.isAppearanceLightStatusBars = it }
    initialStatusBarColor?.let { window.statusBarColor = it }
    controller.show(WindowInsetsCompat.Type.statusBars())
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyAll()
  }

  private fun applyAll() {
    applyBarStyle()
    applyHidden()
    applyBackgroundColor()
  }

  private fun applyBarStyle() {
    val (window, controller) = resolveWindow() ?: return
    val style = barStyle?.lowercase()
    when (style) {
      "dark-content" -> controller.isAppearanceLightStatusBars = true
      "light-content" -> controller.isAppearanceLightStatusBars = false
      "default" -> initialLightStatusBars?.let { controller.isAppearanceLightStatusBars = it }
    }
    // Ensure we keep a reference to the resolved window for later calls
    currentWindow = window
  }

  private fun applyHidden() {
    val (window, controller) = resolveWindow() ?: return
    when (hidden) {
      true -> controller.hide(WindowInsetsCompat.Type.statusBars())
      false -> controller.show(WindowInsetsCompat.Type.statusBars())
      null -> Unit
    }
    currentWindow = window
  }

  private fun applyBackgroundColor() {
    val (window, _) = resolveWindow() ?: return
    val targetColor = backgroundColorValue ?: return
    if (animated) {
      val startColor = window.statusBarColor
      if (startColor != targetColor) {
        colorAnimator?.cancel()
        colorAnimator = ValueAnimator.ofArgb(startColor, targetColor).apply {
          duration = 200
          addUpdateListener { animator ->
            window.statusBarColor = animator.animatedValue as Int
          }
          start()
        }
        return
      }
    }
    window.statusBarColor = targetColor
    currentWindow = window
  }

  private fun resolveWindow(): Pair<Window, WindowInsetsControllerCompat>? {
    val activity = findActivity() ?: return null
    val window = activity.window ?: return null
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    if (currentWindow !== window) {
      initialStatusBarColor = window.statusBarColor
      initialLightStatusBars = controller.isAppearanceLightStatusBars
      currentWindow = window
    }
    return window to controller
  }

  private fun findActivity(): Activity? {
    var ctx: Context? = context
    while (ctx is ContextWrapper) {
      if (ctx is Activity) return ctx
      ctx = ctx.baseContext
    }
    return null
  }

  private fun parseColor(raw: String?): Int? {
    val value = raw?.trim()?.trim('"') ?: return null
    if (value.isEmpty() || value == "null") return null
    return try {
      when {
        value.equals("transparent", ignoreCase = true) -> Color.TRANSPARENT
        // Handle #RRGGBBAA -> #AARRGGBB
        value.startsWith("#") && value.length == 9 -> {
          val rr = value.substring(1, 3)
          val gg = value.substring(3, 5)
          val bb = value.substring(5, 7)
          val aa = value.substring(7, 9)
          Color.parseColor("#$aa$rr$gg$bb")
        }
        value.startsWith("#") -> Color.parseColor(value)
        else -> Color.parseColor("#$value")
      }
    } catch (_: IllegalArgumentException) {
      null
    }
  }
}
