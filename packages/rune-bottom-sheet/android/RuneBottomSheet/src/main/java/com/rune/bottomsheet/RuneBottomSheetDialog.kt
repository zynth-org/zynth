package com.rune.bottomsheet

import android.content.Context
import android.content.DialogInterface
import android.graphics.Color
import android.view.View
import android.widget.FrameLayout
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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
  private var isDraggable: Boolean = true
  private var snapPoints: List<BottomSheetSnapPoint> = DEFAULT_SNAP_POINTS
  private var resolvedSnapHeights: List<Int> = emptyList()
  private var screenHeight: Int = RuneBottomSheetUtils.screenHeight(context)
  private var behavior: BottomSheetBehavior<FrameLayout>? = null
  private var sheetContainer: FrameLayout? = null
  private var overlayView: View? = null
  private var lastOverlayProgress: Float = 0f
  private var pendingIndex: Int = 0
  private var hasPresentedOnce: Boolean = false
  private var systemBottomInset: Int = 0
  private var pendingHeightRestore: Int? = null
  private var pendingExpandedOffset: Int? = null
  private val bottomSheetCallback = object : BottomSheetBehavior.BottomSheetCallback() {
    override fun onSlide(bottomSheet: View, slideOffset: Float) {
      listener?.onSlide(bottomSheet, slideOffset)
      updateOverlayProgress(bottomSheet)
    }

    override fun onStateChanged(bottomSheet: View, newState: Int) {
      listener?.onStateChanged(bottomSheet, newState)
      if (newState != BottomSheetBehavior.STATE_EXPANDED) {
        commitPendingExpandedOffset()
      }
    }
  }

  init {
    setContentView(contentHost)
    contentHost.layoutParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT,
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
    pendingHeightRestore = sheetContainer?.let { visibleHeightForSheet(it) }
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

  fun setDraggable(enabled: Boolean) {
    isDraggable = enabled
    behavior?.isDraggable = enabled
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
      ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
        val defaultInsets = ViewCompat.onApplyWindowInsets(view, insets)
        val systemBars = defaultInsets.getInsets(WindowInsetsCompat.Type.systemBars())
        systemBottomInset = systemBars.bottom
        updateContentPadding()
        view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, 0)
        WindowInsetsCompat.Builder(defaultInsets)
          .setInsets(
            WindowInsetsCompat.Type.systemBars(),
            Insets.of(systemBars.left, systemBars.top, systemBars.right, 0),
          )
          .build()
      }
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
    applyStateForIndex(index)
  }

  private fun applyStateForIndex(index: Int) {
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
    val expandedOffset = (screenHeight - maxHeight).coerceAtLeast(0)
    state.maxHeight = maxHeight
    state.isHideable = true
    state.isDraggable = isDraggable
    applyExpandedOffset(expandedOffset)
    updateContentPadding()
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
    val hostParams = contentHost.layoutParams
    if (hostParams == null) {
      contentHost.layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, maxHeight)
    } else if (hostParams.height != maxHeight) {
      hostParams.height = maxHeight
      contentHost.layoutParams = hostParams
    }
    contentHost.requestLayout()
    restorePendingHeightIfNeeded()
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

  private fun updateContentPadding() {
    if (contentHost.paddingBottom != 0) {
      contentHost.setPadding(contentHost.paddingLeft, contentHost.paddingTop, contentHost.paddingRight, 0)
    }
  }

  private fun restorePendingHeightIfNeeded() {
    val height = pendingHeightRestore ?: return
    pendingHeightRestore = null
    val index = nearestIndexForHeight(height)
    applyStateForIndex(index)
    commitPendingExpandedOffset()
  }

  private fun applyExpandedOffset(offset: Int) {
    val behavior = behavior ?: return
    if (pendingHeightRestore != null && behavior.state == BottomSheetBehavior.STATE_EXPANDED) {
      pendingExpandedOffset = offset
      return
    }
    behavior.expandedOffset = offset
    pendingExpandedOffset = null
  }

  private fun commitPendingExpandedOffset() {
    val behavior = behavior ?: return
    val pending = pendingExpandedOffset ?: return
    if (behavior.state == BottomSheetBehavior.STATE_EXPANDED) {
      return
    }
    behavior.expandedOffset = pending
    pendingExpandedOffset = null
  }
}
