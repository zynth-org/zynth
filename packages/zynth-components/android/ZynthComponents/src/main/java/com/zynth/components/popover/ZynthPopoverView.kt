package com.zynth.components.popover

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import android.widget.PopupWindow
import androidx.dynamicanimation.animation.DynamicAnimation
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce
import com.google.android.material.card.MaterialCardView
import com.google.android.material.color.MaterialColors
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject

private data class PopoverShowRequest(
  val source: String = "trigger",
  val anchorNodeId: Int? = null,
  val x: Int? = null,
  val y: Int? = null,
)

class ZynthPopoverView(context: Context) : FrameLayout(context) {
  var manager: ZynthUIManager? = null
  var nodeId: Int = -1
  var hasOnOpenHandler = false
  var hasOnCloseHandler = false

  private val parkingContainer = FrameLayout(context).apply {
    clipChildren = false
    clipToPadding = false
    isClickable = false
    isFocusable = false
    isEnabled = false
    alpha = 0f
    visibility = View.INVISIBLE
    layoutParams = LayoutParams(0, 0)
  }

  private var triggerView: ZynthPopoverTriggerView? = null
  private var contentView: ZynthPopoverContentView? = null
  private var activePopup: PopupWindow? = null
  private var activeSurface: MaterialCardView? = null
  private var isReparentingContent = false

  private var surfaceColor: Int? = null
  private var cornerRadiusDp: Float = 16f
  private var elevationDp: Float = 8f
  private var dismissOnOutsidePress: Boolean = true
  private var offsetXDp: Float = 0f
  private var offsetYDp: Float = 8f

  init {
    clipChildren = false
    clipToPadding = false
    super.addView(parkingContainer, 0, parkingContainer.layoutParams)
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    when (child) {
      parkingContainer -> Unit
      is ZynthPopoverTriggerView -> attachTrigger(child)
      is ZynthPopoverContentView -> attachContent(child)
    }
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    if (child === triggerView) {
      triggerView?.popoverView = null
      triggerView = null
      return
    }
    if (!isReparentingContent && child === contentView) {
      contentView = null
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    dismiss()
  }

  fun setSurfaceColor(color: Int?) {
    surfaceColor = color
    activeSurface?.setCardBackgroundColor(resolveSurfaceColor())
  }

  fun setCornerRadius(valueDp: Float?) {
    if (valueDp != null && valueDp.isFinite()) {
      cornerRadiusDp = valueDp.coerceAtLeast(0f)
      activeSurface?.radius = dp(cornerRadiusDp)
    }
  }

  fun setElevation(valueDp: Float?) {
    if (valueDp != null && valueDp.isFinite()) {
      elevationDp = valueDp.coerceAtLeast(0f)
      activeSurface?.cardElevation = dp(elevationDp)
      activePopup?.elevation = dp(elevationDp)
    }
  }

  fun setDismissOnOutsidePress(value: Boolean) {
    dismissOnOutsidePress = value
    activePopup?.isOutsideTouchable = value
  }

  fun setOffsetX(valueDp: Float?) {
    if (valueDp != null && valueDp.isFinite()) {
      offsetXDp = valueDp
    }
  }

  fun setOffsetY(valueDp: Float?) {
    if (valueDp != null && valueDp.isFinite()) {
      offsetYDp = valueDp
    }
  }

  fun showFromTrigger() {
    show(
      PopoverShowRequest(
        source = "trigger",
      ),
    )
  }

  fun handleCommand(commandJson: String?) {
    if (commandJson.isNullOrBlank()) return
    try {
      val command = JSONObject(commandJson)
      when (command.optString("type")) {
        "show" -> {
          val request = PopoverShowRequest(
            source = command.optString("source", "trigger"),
            anchorNodeId = if (command.has("anchorNodeId") && !command.isNull("anchorNodeId")) {
              command.optInt("anchorNodeId").takeIf { it > 0 }
            } else {
              null
            },
            x = if (command.has("x") && !command.isNull("x")) {
              command.optDouble("x").toInt()
            } else {
              null
            },
            y = if (command.has("y") && !command.isNull("y")) {
              command.optDouble("y").toInt()
            } else {
              null
            },
          )
          show(request)
        }
        "dismiss" -> dismiss()
      }
    } catch (_: Exception) {
    }
  }

  fun dismiss() {
    dismissInternal(dispatchCloseEvent = true)
  }

  private fun dismissInternal(dispatchCloseEvent: Boolean) {
    val popup = activePopup ?: return
    val surface = activeSurface
    if (surface != null && popup.isShowing) {
      animateSurfaceOut(surface) {
        popup.setOnDismissListener(null)
        popup.dismiss()
        teardownAfterDismiss()
        if (dispatchCloseEvent && hasOnCloseHandler) {
          manager?.dispatchEvent(nodeId, "onClose", JSONObject())
        }
      }
      return
    } else {
      popup.setOnDismissListener(null)
      popup.dismiss()
      teardownAfterDismiss()
      if (dispatchCloseEvent && hasOnCloseHandler) {
        manager?.dispatchEvent(nodeId, "onClose", JSONObject())
      }
    }
  }

  fun reset() {
    dismiss()
    hasOnOpenHandler = false
    hasOnCloseHandler = false
    triggerView?.popoverView = null
    triggerView = null
    contentView?.reset()
    contentView = null
    manager = null
    nodeId = -1
    surfaceColor = null
    cornerRadiusDp = 16f
    elevationDp = 8f
    dismissOnOutsidePress = true
    offsetXDp = 0f
    offsetYDp = 8f
  }

  private fun show(request: PopoverShowRequest) {
    if (!isAttachedToWindow) return
    val content = contentView ?: return

    val anchor = resolveAnchor(request) ?: return
    if (!anchor.isAttachedToWindow) return

    dismissInternal(dispatchCloseEvent = false)

    val surface = createSurface(content)
    val popup = PopupWindow(
      surface,
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT,
      true,
    ).apply {
      isOutsideTouchable = dismissOnOutsidePress
      isClippingEnabled = true
      setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      animationStyle = 0
      elevation = dp(elevationDp)
    }

    popup.setOnDismissListener {
      teardownAfterDismiss()
      if (hasOnCloseHandler) {
        manager?.dispatchEvent(nodeId, "onClose", JSONObject())
      }
    }

    activeSurface = surface
    activePopup = popup

    val xOffset = dp(offsetXDp).toInt()
    val yOffset = dp(offsetYDp).toInt()
    if (request.source == "coordinates" && request.x != null && request.y != null) {
      val root = rootView ?: this
      popup.showAtLocation(
        root,
        Gravity.START or Gravity.TOP,
        request.x + xOffset,
        request.y + yOffset,
      )
    } else {
      popup.showAsDropDown(anchor, xOffset, yOffset, Gravity.START)
    }
    animateSurfaceIn(surface)

    if (hasOnOpenHandler) {
      manager?.dispatchEvent(nodeId, "onOpen", JSONObject())
    }
  }

  private fun resolveAnchor(request: PopoverShowRequest): View? {
    if (request.source == "coordinates") {
      return rootView ?: this
    }

    if (request.source == "anchor") {
      val anchorById = request.anchorNodeId
        ?.let { manager?.getNodeView(it) }
        ?.takeIf { it.isAttachedToWindow }
      if (anchorById != null) return anchorById
    }

    return triggerView?.takeIf { it.isAttachedToWindow }
      ?: request.anchorNodeId
        ?.let { manager?.getNodeView(it) }
        ?.takeIf { it.isAttachedToWindow }
      ?: rootView
      ?: this
  }

  private fun attachTrigger(trigger: ZynthPopoverTriggerView) {
    if (triggerView === trigger) return
    triggerView?.popoverView = null
    triggerView = trigger
    trigger.popoverView = this
  }

  private fun attachContent(content: ZynthPopoverContentView) {
    if (contentView === content) return
    if (contentView != null && contentView !== content) {
      moveContentToParking(contentView!!)
      contentView?.setParked(true)
    }
    contentView = content
    moveContentToParking(content)
    content.setParked(true)
  }

  private fun moveContentToParking(content: ZynthPopoverContentView) {
    if (content.parent === parkingContainer) return
    isReparentingContent = true
    try {
      (content.parent as? ViewGroup)?.removeView(content)
      parkingContainer.addView(
        content,
        LayoutParams(
          LayoutParams.WRAP_CONTENT,
          LayoutParams.WRAP_CONTENT,
        ),
      )
    } finally {
      isReparentingContent = false
    }
  }

  private fun createSurface(content: ZynthPopoverContentView): MaterialCardView {
    val card = MaterialCardView(context).apply {
      radius = dp(cornerRadiusDp)
      cardElevation = dp(elevationDp)
      setCardBackgroundColor(resolveSurfaceColor())
      strokeWidth = 0
      preventCornerOverlap = false
      useCompatPadding = false
      clipToPadding = false
      clipChildren = false
    }

    (content.parent as? ViewGroup)?.removeView(content)
    content.setParked(false)
    card.addView(
      content,
      LayoutParams(
        LayoutParams.WRAP_CONTENT,
        LayoutParams.WRAP_CONTENT,
      ),
    )
    val unspecifiedMeasureSpec = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
    content.measure(unspecifiedMeasureSpec, unspecifiedMeasureSpec)
    content.layout(0, 0, content.measuredWidth, content.measuredHeight)
    card.measure(unspecifiedMeasureSpec, unspecifiedMeasureSpec)
    card.layout(0, 0, card.measuredWidth, card.measuredHeight)
    return card
  }

  private fun teardownAfterDismiss() {
    val content = contentView
    val surface = activeSurface
    if (content != null) {
      if (content.parent === surface) {
        surface?.removeView(content)
      }
      moveContentToParking(content)
      content.setParked(true)
    }
    activeSurface = null
    activePopup = null
  }

  private fun resolveSurfaceColor(): Int {
    val explicit = surfaceColor
    if (explicit != null) return explicit

    val fallbackSurface = MaterialColors.getColor(
      this,
      com.google.android.material.R.attr.colorSurface,
      Color.WHITE,
    )
    return MaterialColors.getColor(
      this,
      com.google.android.material.R.attr.colorSurfaceContainerHigh,
      fallbackSurface,
    )
  }

  private fun animateSurfaceIn(surface: MaterialCardView) {
    surface.animate().cancel()
    surface.alpha = 0f
    surface.translationY = dp(8f)

    val translationSpring = SpringAnimation(surface, DynamicAnimation.TRANSLATION_Y, 0f).apply {
      spring = SpringForce(0f).apply {
        // Subtle, non-bouncy Material-like settling.
        dampingRatio = 0.92f
        stiffness = 760f
      }
    }

    val alphaSpring = SpringAnimation(surface, DynamicAnimation.ALPHA, 1f).apply {
      spring = SpringForce(1f).apply {
        dampingRatio = 1.0f
        stiffness = 900f
      }
    }

    translationSpring.start()
    alphaSpring.start()
  }

  private fun animateSurfaceOut(surface: MaterialCardView, onEnd: () -> Unit) {
    surface.animate().cancel()

    val translationTarget = dp(6f)
    val translationSpring = SpringAnimation(
      surface,
      DynamicAnimation.TRANSLATION_Y,
      translationTarget,
    ).apply {
      spring = SpringForce(translationTarget).apply {
        dampingRatio = 1.0f
        stiffness = 900f
      }
    }

    val alphaSpring = SpringAnimation(surface, DynamicAnimation.ALPHA, 0f).apply {
      spring = SpringForce(0f).apply {
        dampingRatio = 1.0f
        stiffness = 1000f
      }
      addEndListener { _, _, _, _ ->
        onEnd()
      }
    }

    translationSpring.start()
    alphaSpring.start()
  }

  private fun dp(value: Float): Float {
    return value * resources.displayMetrics.density
  }
}
