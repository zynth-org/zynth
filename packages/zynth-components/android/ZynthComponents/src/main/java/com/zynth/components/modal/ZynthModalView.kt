package com.zynth.components.modal

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.core.view.WindowCompat
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject

enum class ZynthModalAnimation {
  FADE,
  SLIDE,
  ZOOM,
  NONE;

  companion object {
    fun from(raw: String?): ZynthModalAnimation {
      return when (raw?.lowercase()) {
        "slide" -> SLIDE
        "zoom" -> ZOOM
        "none" -> NONE
        else -> FADE
      }
    }
  }
}

data class ZynthModalOptions(
  var animation: ZynthModalAnimation = ZynthModalAnimation.FADE,
  var transparent: Boolean = false,
  var overlayColor: Int = Color.BLACK,
  var overlayOpacity: Float = 0.45f,
  var dismissOnOverlayPress: Boolean = true,
)

class ZynthModalView(context: Context) : FrameLayout(context) {
  var manager: ZynthUIManager? = null
  var nodeId: Int = -1

  private val contentHost = FrameLayout(context)
  private var options = ZynthModalOptions()
  private var dialog: ZynthModalDialog? = null
  private var isOpen = false

  init {
    clipChildren = false
    clipToPadding = false
    contentHost.layoutParams = LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.MATCH_PARENT,
    )
    contentHost.visibility = View.GONE
    super.addView(contentHost, 0, contentHost.layoutParams)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Keep the modal host out of normal layout flow; content is rendered in a dialog.
    setMeasuredDimension(0, 0)
  }


  override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
    if (child === contentHost) {
      super.addView(child, index, params)
    } else {
      contentHost.addView(child, index, params)
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    dismiss()
  }

  fun setOpenState(open: Boolean) {
    if (open) {
      present()
    } else {
      dismiss()
    }
  }

  fun setAnimationStyle(value: String?) {
    options.animation = ZynthModalAnimation.from(value)
    dialog?.updateOptions(options)
  }

  fun setTransparent(value: Boolean) {
    options.transparent = value
    dialog?.updateOptions(options)
  }

  fun setOverlayColor(color: Int?) {
    if (color != null) {
      options.overlayColor = color
      dialog?.updateOptions(options)
    }
  }

  fun setOverlayOpacity(value: Float?) {
    if (value != null) {
      options.overlayOpacity = value.coerceIn(0f, 1f)
      dialog?.updateOptions(options)
    }
  }

  fun setDismissOnOverlayPress(value: Boolean) {
    options.dismissOnOverlayPress = value
    dialog?.updateOptions(options)
  }

  fun handleCommand(commandJson: String?) {
    if (commandJson.isNullOrBlank()) return
    try {
      val command = JSONObject(commandJson)
      when (command.optString("type")) {
        "show" -> present()
        "dismiss" -> dismiss()
      }
    } catch (_: Exception) {
    }
  }

  fun reset() {
    dismiss()
    dialog = null
    options = ZynthModalOptions()
    manager = null
    nodeId = -1
  }

  private fun present() {
    if (isOpen) return
    val activity = findActivity() ?: return
    if (activity.isFinishing || activity.isDestroyed) return
    val resolvedDialog = dialog ?: ZynthModalDialog(activity, this, contentHost).also {
      dialog = it
    }
    resolvedDialog.updateOptions(options)
    resolvedDialog.showModal()
    isOpen = true
  }

  private fun dismiss() {
    if (!isOpen) return
    val activeDialog = dialog
    if (activeDialog == null) {
      isOpen = false
      return
    }
    activeDialog.dismissModal()
  }

  private fun findActivity(): Activity? {
    var current: Context? = context
    while (current is ContextWrapper) {
      if (current is Activity) return current
      current = current.baseContext
    }
    return null
  }

  private fun dispatchEvent(name: String, payload: JSONObject?) {
    val manager = manager ?: return
    if (nodeId < 0) return
    manager.dispatchEvent(nodeId, name, payload)
  }

  private inner class ZynthModalDialog(
    context: Context,
    private val hostView: ZynthModalView,
    private val content: FrameLayout,
  ) : Dialog(context, android.R.style.Theme_Translucent_NoTitleBar_Fullscreen) {

    private val root = FrameLayout(context)
    private val overlayView = View(context)
    private val contentContainer = FrameLayout(context)
    private var options = ZynthModalOptions()
    private var isAnimatingOut = false
    private var hasCompletedEnterAnimation = false

    init {
      window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      window?.setDimAmount(0f)
      window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
      window?.setWindowAnimations(0)
      configureEdgeToEdgeWindow()

      root.layoutParams = LayoutParams(
        LayoutParams.MATCH_PARENT,
        LayoutParams.MATCH_PARENT,
      )
      overlayView.layoutParams = LayoutParams(
        LayoutParams.MATCH_PARENT,
        LayoutParams.MATCH_PARENT,
      )
      overlayView.alpha = 0f
      contentContainer.layoutParams = LayoutParams(
        LayoutParams.MATCH_PARENT,
        LayoutParams.MATCH_PARENT,
      )

      overlayView.isClickable = true
      overlayView.setOnClickListener {
        if (options.dismissOnOverlayPress) {
          hostView.dispatchEvent("onRequestClose", JSONObject())
          hostView.dismiss()
        }
      }

      root.addView(overlayView)
      root.addView(contentContainer)
      setContentView(root)

      setOnShowListener {
        hasCompletedEnterAnimation = false
        isAnimatingOut = false
        attachContent()
        applyOverlayState()
        prepareEnterState()
        animateIn()
        hostView.dispatchEvent("onOpenChange", JSONObject().put("open", true))
      }

      setOnDismissListener {
        detachContent()
        hasCompletedEnterAnimation = false
        isAnimatingOut = false
        hostView.isOpen = false
        hostView.dispatchEvent("onOpenChange", JSONObject().put("open", false))
        hostView.dispatchEvent("onDismiss", JSONObject())
      }
    }

    private fun configureEdgeToEdgeWindow() {
      val dialogWindow = window ?: return
      dialogWindow.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
      dialogWindow.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS)
      dialogWindow.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION)
      WindowCompat.setDecorFitsSystemWindows(dialogWindow, false)
      dialogWindow.setLayout(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
      )
      dialogWindow.statusBarColor = Color.TRANSPARENT
      dialogWindow.navigationBarColor = Color.TRANSPARENT

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        dialogWindow.isNavigationBarContrastEnforced = false
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val attributes = dialogWindow.attributes
        attributes.layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        dialogWindow.attributes = attributes
      }
    }

    fun updateOptions(newOptions: ZynthModalOptions) {
      options = newOptions
      applyOverlayState()
    }

    fun showModal() {
      if (isShowing) return
      show()
    }

    fun dismissModal() {
      if (!isShowing || isAnimatingOut) return
      isAnimatingOut = true
      if (options.animation == ZynthModalAnimation.NONE) {
        dismiss()
        isAnimatingOut = false
        return
      }
      animateOut {
        dismiss()
        isAnimatingOut = false
      }
    }

    private fun attachContent() {
      content.visibility = View.VISIBLE
      if (content.parent !== contentContainer) {
        (content.parent as? ViewGroup)?.removeView(content)
        contentContainer.addView(
          content,
          LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
        )
      }
    }

    private fun detachContent() {
      if (content.parent === contentContainer) {
        contentContainer.removeView(content)
      }
      if (content.parent !== hostView) {
        hostView.addView(
          content,
          0,
          LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
        )
      }
      content.visibility = View.GONE
    }

    private fun overlayTargetAlpha(): Float {
      return if (options.transparent) 0f else options.overlayOpacity.coerceIn(0f, 1f)
    }

    private fun applyOverlayState() {
      overlayView.setBackgroundColor(options.overlayColor)
      if (!isShowing) {
        overlayView.alpha = if (options.animation == ZynthModalAnimation.NONE) overlayTargetAlpha() else 0f
        return
      }

      if (!hasCompletedEnterAnimation && options.animation != ZynthModalAnimation.NONE && !isAnimatingOut) {
        overlayView.alpha = 0f
        return
      }

      overlayView.alpha = overlayTargetAlpha()
    }

    private fun prepareEnterState() {
      val overlayAlpha = overlayTargetAlpha()
      overlayView.alpha = 0f
      contentContainer.alpha = 1f
      contentContainer.translationY = 0f
      contentContainer.scaleX = 1f
      contentContainer.scaleY = 1f

      when (options.animation) {
        ZynthModalAnimation.FADE -> {
          contentContainer.alpha = 0f
        }
        ZynthModalAnimation.SLIDE -> {
          val distance = root.height.takeIf { it > 0 }
            ?: context.resources.displayMetrics.heightPixels
          contentContainer.translationY = distance.toFloat()
        }
        ZynthModalAnimation.ZOOM -> {
          contentContainer.alpha = 0f
          contentContainer.scaleX = 0.92f
          contentContainer.scaleY = 0.92f
        }
        ZynthModalAnimation.NONE -> {
          overlayView.alpha = overlayAlpha
          contentContainer.alpha = 1f
        }
      }
    }

    private fun animateIn() {
      if (options.animation == ZynthModalAnimation.NONE) {
        hasCompletedEnterAnimation = true
        return
      }
      root.post {
        val overlayAlpha = overlayTargetAlpha()
        val duration = when (options.animation) {
          ZynthModalAnimation.FADE -> 180L
          ZynthModalAnimation.SLIDE -> 280L
          ZynthModalAnimation.ZOOM -> 220L
          ZynthModalAnimation.NONE -> 0L
        }

        overlayView.animate()
          .alpha(overlayAlpha)
          .setDuration(duration)
          .setStartDelay(0L)
          .withEndAction {
            hasCompletedEnterAnimation = true
          }
          .start()

        when (options.animation) {
          ZynthModalAnimation.FADE -> {
            contentContainer.animate()
              .alpha(1f)
              .setDuration(duration)
              .start()
          }
          ZynthModalAnimation.SLIDE -> {
            contentContainer.animate()
              .translationY(0f)
              .setDuration(duration)
              .start()
          }
          ZynthModalAnimation.ZOOM -> {
            contentContainer.animate()
              .alpha(1f)
              .scaleX(1f)
              .scaleY(1f)
              .setDuration(duration)
              .start()
          }
          ZynthModalAnimation.NONE -> Unit
        }
      }
    }

    private fun animateOut(onEnd: () -> Unit) {
      val duration = when (options.animation) {
        ZynthModalAnimation.FADE -> 160L
        ZynthModalAnimation.SLIDE -> 220L
        ZynthModalAnimation.ZOOM -> 180L
        ZynthModalAnimation.NONE -> 0L
      }
      overlayView.animate()
        .alpha(0f)
        .setDuration(duration)
        .start()

      when (options.animation) {
        ZynthModalAnimation.FADE -> {
          contentContainer.animate()
            .alpha(0f)
            .setDuration(duration)
            .withEndAction(onEnd)
            .start()
        }
        ZynthModalAnimation.SLIDE -> {
          val distance = root.height.takeIf { it > 0 }
            ?: context.resources.displayMetrics.heightPixels
          contentContainer.animate()
            .translationY(distance.toFloat())
            .setDuration(duration)
            .withEndAction(onEnd)
            .start()
        }
        ZynthModalAnimation.ZOOM -> {
          contentContainer.animate()
            .alpha(0f)
            .scaleX(0.92f)
            .scaleY(0.92f)
            .setDuration(duration)
            .withEndAction(onEnd)
            .start()
        }
        ZynthModalAnimation.NONE -> onEnd()
      }
    }
  }
}
