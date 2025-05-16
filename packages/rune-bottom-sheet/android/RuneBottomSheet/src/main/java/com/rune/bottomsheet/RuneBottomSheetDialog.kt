package com.rune.bottomsheet

import android.content.Context
import android.content.DialogInterface
import android.graphics.Color
import android.view.View
import android.widget.FrameLayout
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import kotlin.math.abs

class RuneBottomSheetDialog(
  context: Context,
  private val contentHost: FrameLayout,
) : BottomSheetDialog(context) {

  interface Listener {
    fun onShow()
    fun onDismiss()
    fun onSlide(sheet: View, slideOffset: Float)
    fun onStateChanged(sheet: View, newState: Int)
  }

  private companion object {
    val DEFAULT_SNAP_POINTS = listOf(
      BottomSheetSnapPoint.Percent(0.4f),
      BottomSheetSnapPoint.Percent(0.83f),
    )
  }

  var listener: Listener? = null
  private var overlayColor: Int = Color.BLACK
  private var overlayOpacity: Float = 0.58f
  private var dismissOnOverlayPress: Boolean = true
  private var snapPoints: List<BottomSheetSnapPoint> = DEFAULT_SNAP_POINTS
  private var resolvedSnapHeights: List<Int> = emptyList()
  private var screenHeight: Int = RuneBottomSheetUtils.screenHeight(context)
  private var behavior: BottomSheetBehavior<FrameLayout>? = null
  private var sheetContainer: FrameLayout? = null
  private var overlayView: View? = null
  private var lastOverlayProgress: Float = 0f
  private var pendingIndex: Int = 0
  private var hasPresentedOnce: Boolean = false
  private val bottomSheetCallback = object : BottomSheetBehavior.BottomSheetCallback() {
    override fun onSlide(bottomSheet: View, slideOffset: Float) {
      listener?.onSlide(bottomSheet, slideOffset)
      updateOverlayProgress(bottomSheet)
    }

    override fun onStateChanged(bottomSheet: View, newState: Int) {
      listener?.onStateChanged(bottomSheet, newState)
    }
  }

  init {
    setContentView(contentHost)
    contentHost.layoutParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.WRAP_CONTENT,
    )
    setCancelable(true)
    setCanceledOnTouchOutside(false)
    setOnShowListener(::handleShow)
    setOnDismissListener {
      overlayView = null
      sheetContainer = null
      lastOverlayProgress = 0f
      listener?.onDismiss()
    }
    window?.setWindowAnimations(0)
    window?.setDimAmount(0f)
  }

  fun setSnapPoints(points: List<BottomSheetSnapPoint>) {
    snapPoints = if (points.isEmpty()) DEFAULT_SNAP_POINTS else points
    configureBehavior()
  }

  fun setOverlayColor(color: Int) {
    overlayColor = color
    applyOverlay()
  }

  fun setOverlayOpacity(opacity: Float) {
    overlayOpacity = opacity.coerceIn(0f, 1f)
    applyOverlay()
  }

  fun setDismissOnOverlayPress(enabled: Boolean) {
    dismissOnOverlayPress = enabled
    applyDismissBehavior()
  }

  fun present(index: Int, animated: Boolean = true) {
    pendingIndex = index
    if (isShowing) {
      setStateForIndex(index, animated)
      return
    }
    show()
  }

  fun dismissSheet() {
    val behavior = behavior
    if (behavior == null) {
      dismiss()
      return
    }
    if (behavior.state == BottomSheetBehavior.STATE_HIDDEN) {
      dismiss()
    } else {
      behavior.state = BottomSheetBehavior.STATE_HIDDEN
    }
  }

  fun snapTo(index: Int) {
    setStateForIndex(index, animated = true)
  }

  fun getResolvedSnapHeights(): List<Int> = resolvedSnapHeights
  fun getMaxScreenHeight(): Int = screenHeight
  fun visibleHeightForSheet(view: View): Int = (screenHeight - view.top).coerceAtLeast(0)
  fun nearestIndexForHeight(height: Int): Int {
    if (resolvedSnapHeights.isEmpty()) return 0
    var nearest = 0
    var bestDiff = Int.MAX_VALUE
    resolvedSnapHeights.forEachIndexed { index, value ->
      val diff = abs(value - height)
      if (diff < bestDiff) {
        bestDiff = diff
        nearest = index
      }
    }
    return nearest
  }

  private fun handleShow(dialog: DialogInterface) {
    screenHeight = RuneBottomSheetUtils.screenHeight(context)
    sheetContainer = findViewById(com.google.android.material.R.id.design_bottom_sheet)
    sheetContainer?.let { container ->
      container.setBackgroundColor(Color.TRANSPARENT)
      container.background = null
      behavior = BottomSheetBehavior.from(container).apply {
        addBottomSheetCallback(bottomSheetCallback)
      }
      configureBehavior(animatePeek = hasPresentedOnce)
      if (!hasPresentedOnce) {
        behavior?.let(::prepareEntranceState)
        container.post {
          behavior?.let {
            configureBehavior(animatePeek = true)
            setStateForIndex(pendingIndex, animated = true)
            hasPresentedOnce = true
          }
        }
      } else {
        setStateForIndex(pendingIndex, animated = true)
      }
    }
    overlayView = window?.findViewById<View>(com.google.android.material.R.id.touch_outside)?.also { outside ->
      outside.alpha = 0f
    }
    applyOverlay()
    applyDismissBehavior()
    listener?.onShow()
  }

  private fun configureBehavior(animatePeek: Boolean = false) {
    val metrics = context.resources.displayMetrics
    resolvedSnapHeights = snapPoints.mapNotNull {
      val resolved = it.resolveHeight(screenHeight, metrics)
      resolved
        .coerceAtMost(screenHeight)
        .takeIf { height -> height > 0 }
    }.distinct().sorted()

    if (resolvedSnapHeights.isEmpty()) {
      resolvedSnapHeights = DEFAULT_SNAP_POINTS.mapNotNull {
        it.resolveHeight(screenHeight, metrics).takeIf { height -> height > 0 }
      }
    }
    if (resolvedSnapHeights.isEmpty()) {
      resolvedSnapHeights = listOf(screenHeight)
    }

    behavior?.let { applyBehaviorConfiguration(it, animatePeek) }
  }

  private fun setStateForIndex(index: Int, animated: Boolean) {
    pendingIndex = index
    val behavior = behavior ?: return
    val resolvedIndex = normalizedIndex(index)
    val state = getStateForSizeIndex(resolvedIndex)
    if (behavior.state != state) {
      behavior.state = state
    }
  }

  private fun normalizedIndex(index: Int): Int {
    val size = resolvedSnapHeights.size.coerceAtLeast(1)
    return index.coerceIn(0, size - 1)
  }

  private fun getStateForSizeIndex(index: Int): Int {
    return when (resolvedSnapHeights.size) {
      1 -> BottomSheetBehavior.STATE_EXPANDED
      2 -> when (index) {
        0 -> BottomSheetBehavior.STATE_COLLAPSED
        1 -> BottomSheetBehavior.STATE_EXPANDED
        else -> BottomSheetBehavior.STATE_HIDDEN
      }
      else -> when (index) {
        0 -> BottomSheetBehavior.STATE_COLLAPSED
        1 -> BottomSheetBehavior.STATE_HALF_EXPANDED
        2 -> BottomSheetBehavior.STATE_EXPANDED
        else -> BottomSheetBehavior.STATE_HIDDEN
      }
    }
  }

  private fun applyOverlay() {
    overlayView?.let {
      it.setBackgroundColor(overlayColor)
      it.visibility = if (lastOverlayProgress > 0f) View.VISIBLE else View.GONE
      it.alpha = overlayOpacity * lastOverlayProgress
    }
  }

  private fun applyDismissBehavior() {
    overlayView?.let { overlay ->
      if (dismissOnOverlayPress) {
        overlay.isClickable = true
        overlay.setOnClickListener { dismissSheet() }
      } else {
        overlay.isClickable = false
        overlay.setOnClickListener(null)
      }
    }
  }

  private fun applyBehaviorConfiguration(state: BottomSheetBehavior<FrameLayout>, animatePeek: Boolean) {
    if (resolvedSnapHeights.isEmpty()) return
    val count = resolvedSnapHeights.size
    val maxHeight = resolvedSnapHeights.last()
    state.maxHeight = maxHeight
    state.isHideable = true
    when (count) {
      1 -> {
        state.isFitToContents = true
        state.skipCollapsed = true
        state.setPeekHeight(maxHeight, animatePeek)
      }
      2 -> {
        state.isFitToContents = true
        state.skipCollapsed = false
        state.setPeekHeight(resolvedSnapHeights.first(), animatePeek)
      }
      else -> {
        state.isFitToContents = false
        state.skipCollapsed = false
        state.setPeekHeight(resolvedSnapHeights.first(), animatePeek)
        val halfRatio = (resolvedSnapHeights.getOrNull(1)?.toFloat() ?: maxHeight.toFloat()) / screenHeight.toFloat()
        state.halfExpandedRatio = halfRatio.coerceIn(0f, 1f)
      }
    }
    sheetContainer?.let { container ->
      val params = container.layoutParams
      if (params.height != maxHeight) {
        params.height = maxHeight
        container.layoutParams = params
      }
    }
  }

  private fun prepareEntranceState(state: BottomSheetBehavior<FrameLayout>) {
    state.isFitToContents = false
    state.skipCollapsed = false
    state.setPeekHeight(0, false)
    state.state = BottomSheetBehavior.STATE_COLLAPSED
  }

  private fun updateOverlayProgress(sheet: View) {
    val maxHeight = resolvedSnapHeights.lastOrNull()?.takeIf { it > 0 } ?: screenHeight
    if (maxHeight <= 0) return
    val visibleHeight = visibleHeightForSheet(sheet).coerceAtLeast(0)
    val progress = (visibleHeight.toFloat() / maxHeight.toFloat()).coerceIn(0f, 1f)
    lastOverlayProgress = progress
    overlayView?.let {
      it.visibility = if (progress > 0f) View.VISIBLE else View.GONE
      it.alpha = overlayOpacity * progress
    }
  }
}
