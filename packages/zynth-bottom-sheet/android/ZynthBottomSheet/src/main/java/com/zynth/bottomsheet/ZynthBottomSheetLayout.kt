package com.zynth.bottomsheet

import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams
import android.widget.FrameLayout
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject

class ZynthBottomSheetLayout @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
) : ViewGroup(context, attrs, defStyleAttr) {

  private val contentHost = FrameLayout(context).apply {
    clipChildren = false
    clipToPadding = false
  }

  private val dialog = ZynthBottomSheetDialog(context, contentHost)
  private var manager: ZynthUIManager? = null
  private var nodeId: Int = -1
  private var currentOptions = ZynthBottomSheetOptions()
  private var isOpen = false

  init {
    dialog.listener = object : ZynthBottomSheetDialog.Listener {
      override fun onShow() {
        updateOpenState(true)
      }

      override fun onDismiss() {
        updateOpenState(false)
        dispatchEvent("onDismiss", null)
      }

      override fun onSlide(sheet: View, slideOffset: Float) {
        handleSlide(sheet, slideOffset)
      }

      override fun onStateChanged(sheet: View, newState: Int) {
        // State changes are only used for internal bookkeeping at the moment.
      }
    }
    applyLayoutOptions(null)
  }

  fun bind(manager: ZynthUIManager, node: ZynthUIManager.Node) {
    this.manager = manager
    this.nodeId = node.id
  }

  fun unbind() {
    manager = null
    nodeId = -1
  }

  fun applyLayoutOptions(options: ZynthBottomSheetOptions?) {
    val resolved = options ?: ZynthBottomSheetOptions()
    currentOptions = resolved
    dialog.setSnapPoints(resolved.snapPoints)
    dialog.setOverlayColor(resolved.overlayColor)
    dialog.setOverlayOpacity(resolved.overlayOpacity)
    dialog.setDismissOnOverlayPress(resolved.dismissOnOverlayPress)
  }

  fun updateLayoutOptions(transform: ZynthBottomSheetOptions.() -> ZynthBottomSheetOptions) {
    applyLayoutOptions(transform(currentOptions))
  }

  fun setOverlayColor(color: Int) {
    dialog.setOverlayColor(color)
  }

  fun setOverlayOpacity(opacity: Float) {
    dialog.setOverlayOpacity(opacity)
  }

  fun setDismissOnOverlayPress(enabled: Boolean) {
    dialog.setDismissOnOverlayPress(enabled)
  }

  fun open(index: Int? = null) {
    val targetIndex = index ?: currentOptions.initialSnapIndex
    dialog.present(targetIndex.coerceAtLeast(0))
  }

  fun close() {
    dialog.dismissSheet()
  }

  fun snapTo(index: Int) {
    dialog.snapTo(index.coerceAtLeast(0))
  }

  fun reset() {
    dialog.dismissSheet()
    isOpen = false
    applyLayoutOptions(null)
  }

  private fun handleSlide(sheet: View, slideOffset: Float) {
    if (manager == null || nodeId < 0) return

    val resolved = dialog.getResolvedSnapHeights()
    val visibleHeight = dialog.visibleHeightForSheet(sheet)
    val nearestIndex = dialog.nearestIndexForHeight(visibleHeight)
    val maxHeight = resolved.lastOrNull()?.takeIf { it > 0 } ?: dialog.getMaxScreenHeight()
    val progress = if (maxHeight > 0) {
      (visibleHeight.toFloat() / maxHeight.toFloat()).coerceIn(0f, 1f)
    } else {
      slideOffset.coerceIn(0f, 1f)
    }
    val payload = JSONObject().put("index", nearestIndex).put("progress", progress)
    dispatchEvent("onSnapChange", payload)
  }

  private fun updateOpenState(open: Boolean) {
    if (isOpen == open) return
    isOpen = open
    val payload = JSONObject().put("open", open)
    dispatchEvent("onOpenChange", payload)
  }

  private fun dispatchEvent(name: String, payload: JSONObject?) {
    if (nodeId < 0) return
    manager?.dispatchEvent(nodeId, name, payload)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(0, 0)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    // Layout handled by the BottomSheetDialog.
  }

  override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
    if (child == null) return
    contentHost.addView(child, index, params)
  }

  override fun addView(child: View?, params: ViewGroup.LayoutParams?) {
    addView(child, -1, params)
  }

  override fun removeView(view: View?) {
    if (view == null) return
    contentHost.removeView(view)
  }

  override fun removeViewAt(index: Int) {
    if (index < 0 || index >= contentHost.childCount) return
    contentHost.removeViewAt(index)
  }

  override fun getChildAt(index: Int): View? = contentHost.getChildAt(index)

  override fun getChildCount(): Int = contentHost.childCount

  override fun generateDefaultLayoutParams(): LayoutParams =
    LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)

  override fun generateLayoutParams(attrs: AttributeSet?): LayoutParams =
    LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)

  override fun checkLayoutParams(p: LayoutParams?): Boolean = p is LayoutParams
}

data class ZynthBottomSheetOptions(
  val snapPoints: List<BottomSheetSnapPoint> = listOf(
    BottomSheetSnapPoint.Percent(0.4f),
    BottomSheetSnapPoint.Percent(0.83f),
  ),
  val overlayColor: Int = Color.BLACK,
  val overlayOpacity: Float = 0.58f,
  val dismissOnOverlayPress: Boolean = true,
  val initialSnapIndex: Int = 0,
)
