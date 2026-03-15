package com.zynth.components.bottomsheet

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.DialogInterface
import android.graphics.Color
import android.graphics.Rect
import android.util.TypedValue
import android.view.Choreographer
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.doOnPreDraw
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import kotlin.math.abs

class ZynthBottomSheetDialog(
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
  private var allowBackgroundInteraction: Boolean = false
  private var allowDismissOnInteraction: Boolean = true
  private var dynamicContentHeight: Boolean = false
  private var isDraggable: Boolean = true
  private var snapPoints: List<BottomSheetSnapPoint> = DEFAULT_SNAP_POINTS
  private var resolvedSnapHeights: List<Int> = emptyList()
  private var measuredContentHeight: Int = 0
  private var contentHeightHintPx: Int? = null
  private var screenHeight: Int = ZynthBottomSheetUtils.screenHeight(context)
  private var behavior: BottomSheetBehavior<FrameLayout>? = null
  private var sheetContainer: FrameLayout? = null
  private var overlayView: View? = null
  private var overlayDefaultWidth: Int? = null
  private var overlayDefaultHeight: Int? = null
  private var overlayParent: ViewGroup? = null
  private var overlayParentIndex: Int = -1
  private var lastOverlayProgress: Float = 0f
  private var pendingIndex: Int = 0
  private var hasPresentedOnce: Boolean = false
  private var systemBottomInset: Int = 0
  private var pendingIndexRestore: Int? = null
  private var pendingExpandedOffset: Int? = null
  private var currentSnapIndex: Int = 0
  private var closeFallbackGeneration: Int = 0
  private var closeFallbackFrameCallback: Choreographer.FrameCallback? = null
  private var forwardingOutsideGesture: Boolean = false
  private var isGlobalLayoutListenerAttached: Boolean = false
  private val contentLayoutChangeListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
    handleContentLayoutChanged()
  }
  private val contentGlobalLayoutListener = ViewTreeObserver.OnGlobalLayoutListener {
    handleContentLayoutChanged()
  }
  private val bottomSheetCallback = object : BottomSheetBehavior.BottomSheetCallback() {
    override fun onSlide(bottomSheet: View, slideOffset: Float) {
      listener?.onSlide(bottomSheet, slideOffset)
      updateOverlayProgress(bottomSheet)
    }

    override fun onStateChanged(bottomSheet: View, newState: Int) {
      listener?.onStateChanged(bottomSheet, newState)
      updateCurrentIndex(bottomSheet, newState)
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
    contentHost.addOnLayoutChangeListener(contentLayoutChangeListener)
    setCancelable(true)
    setCanceledOnTouchOutside(false)
    setOnShowListener(::handleShow)
    setOnDismissListener {
      cancelCloseFallback()
      detachGlobalLayoutListener()
      restoreOverlayToParentIfNeeded()
      overlayView = null
      sheetContainer = null
      lastOverlayProgress = 0f
      listener?.onDismiss()
    }
    window?.setWindowAnimations(0)
    enforceNoSystemDim()
    // Keep the first frame hidden until we fully configure the sheet state.
    window?.decorView?.alpha = 0f
  }

  override fun onStart() {
    super.onStart()
    // BottomSheetDialog/Material can restore dim on first show; force it off again.
    enforceNoSystemDim()
  }

  fun setSnapPoints(points: List<BottomSheetSnapPoint>) {
    if (points == snapPoints) {
      return
    }
    pendingIndexRestore = if (isShowing) {
      currentSnapIndex
    } else {
      null
    }
    snapPoints = points
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

  fun setAllowBackgroundInteraction(enabled: Boolean) {
    allowBackgroundInteraction = enabled
    // Outside taps should pass through to the activity, not cancel the dialog.
    setCancelable(!enabled && allowDismissOnInteraction)
    applyWindowInteractionMode()
    applyOverlay()
    applyDismissBehavior()
  }

  fun setAllowDismissOnInteraction(enabled: Boolean) {
    allowDismissOnInteraction = enabled
    setDraggable(enabled)
    setCancelable(enabled && !allowBackgroundInteraction)
    applyDismissBehavior()
  }

  fun setDynamicContentHeight(enabled: Boolean) {
    if (dynamicContentHeight == enabled) {
      return
    }
    dynamicContentHeight = enabled
    if (!enabled) {
      measuredContentHeight = 0
    } else {
      measuredContentHeight = measureContentHeight().coerceAtLeast(0)
    }
    configureBehavior()
    if (isShowing) {
      if (enabled) {
        attachGlobalLayoutListener()
      } else {
        detachGlobalLayoutListener()
      }
      applyStateForIndex(currentSnapIndex)
    }
  }

  fun setContentHeightHintDp(heightDp: Float?) {
    val metrics = context.resources.displayMetrics
    val nextPx = heightDp
      ?.takeIf { it > 0f }
      ?.let {
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, it, metrics).toInt()
      }
      ?.coerceAtLeast(0)
    if (nextPx == contentHeightHintPx) {
      return
    }
    contentHeightHintPx = nextPx
    if (dynamicContentHeight && isShowing) {
      configureBehavior()
      applyStateForIndex(currentSnapIndex)
    }
  }

  fun setDraggable(enabled: Boolean) {
    isDraggable = enabled
    behavior?.isDraggable = enabled
  }

  fun present(index: Int, animated: Boolean = true) {
    cancelCloseFallback()
    pendingIndex = index
    if (isShowing) {
      setStateForIndex(index, animated)
      return
    }
    if (!hasPresentedOnce) {
      window?.decorView?.alpha = 0f
    }
    enforceNoSystemDim()
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
      scheduleCloseFallback()
    }
  }

  fun snapTo(index: Int) {
    setStateForIndex(index, animated = true)
  }

  fun expand() {
    if (!isShowing) return
    val targetIndex = (resolvedSnapHeights.size - 1).coerceAtLeast(0)
    setStateForIndex(targetIndex, animated = true)
  }

  fun collapse() {
    if (!isShowing) return
    setStateForIndex(0, animated = true)
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

  @Suppress("UNUSED_PARAMETER")
  private fun handleShow(dialog: DialogInterface) {
    screenHeight = ZynthBottomSheetUtils.screenHeight(context)
    if (dynamicContentHeight) {
      measuredContentHeight = measureContentHeight().coerceAtLeast(0)
      attachGlobalLayoutListener()
    }
    enforceNoSystemDim()
    val outsideScrim: View? = window?.findViewById(com.google.android.material.R.id.touch_outside)
    // Prevent Material's default outside scrim from flashing before we apply our own overlay state.
    outsideScrim?.setBackgroundColor(Color.TRANSPARENT)
    outsideScrim?.visibility = View.GONE
    outsideScrim?.alpha = 0f
    overlayView = outsideScrim
    captureOverlayParentIfNeeded()
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

      if (!hasPresentedOnce) {
        hasPresentedOnce = true
        container.visibility = View.INVISIBLE
        // Start from a fully collapsed hidden state before first reveal.
        behavior?.let { prepareEntranceState(it) }
        container.doOnPreDraw {
          configureBehavior(animatePeek = true)
          setStateForIndex(pendingIndex, animated = true)
          container.visibility = View.VISIBLE
          window?.decorView?.alpha = 1f
        }
      } else {
        configureBehavior(animatePeek = false)
        setStateForIndex(pendingIndex, animated = true)
        window?.decorView?.alpha = 1f
      }
      applyCoordinatorPassThroughMode()
    }
    applyWindowInteractionMode()
    applyOverlay()
    applyDismissBehavior()
    listener?.onShow()
  }

  private fun configureBehavior(animatePeek: Boolean = false) {
    val metrics = context.resources.displayMetrics
    val heightCap = resolveDynamicHeightCap()
    if (dynamicContentHeight && snapPoints.isEmpty()) {
      resolvedSnapHeights = listOf(heightCap)
      behavior?.let { applyBehaviorConfiguration(it, animatePeek) }
      return
    }
    resolvedSnapHeights = snapPoints.mapNotNull {
      val resolved = it.resolveHeight(screenHeight, metrics)
      resolved
        .coerceAtMost(heightCap)
        .takeIf { height -> height > 0 }
    }.distinct().sorted()

    if (resolvedSnapHeights.isEmpty()) {
      resolvedSnapHeights = DEFAULT_SNAP_POINTS.mapNotNull {
        it.resolveHeight(screenHeight, metrics)
          .coerceAtMost(heightCap)
          .takeIf { height -> height > 0 }
      }
    }
    if (resolvedSnapHeights.isEmpty()) {
      resolvedSnapHeights = listOf(screenHeight)
    }

    behavior?.let { applyBehaviorConfiguration(it, animatePeek) }
  }

  @Suppress("UNUSED_PARAMETER")
  private fun setStateForIndex(index: Int, animated: Boolean) {
    pendingIndex = index
    applyStateForIndex(index)
  }

  private fun applyStateForIndex(index: Int) {
    val behavior = behavior ?: return
    val resolvedIndex = normalizedIndex(index)
    currentSnapIndex = resolvedIndex
    val state = getStateForSizeIndex(resolvedIndex)
    if (behavior.state != state) {
      behavior.state = state
    }
    sheetContainer?.let { container ->
      container.post { updateOverlayProgress(container) }
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
      if (allowBackgroundInteraction || overlayOpacity <= 0f) {
        it.visibility = View.GONE
        it.alpha = 0f
        return@let
      }
      it.visibility = if (lastOverlayProgress > 0f) View.VISIBLE else View.GONE
      it.alpha = overlayOpacity * lastOverlayProgress
    }
  }

  private fun applyDismissBehavior() {
    overlayView?.let { overlay ->
      val canDismissFromOverlay =
        dismissOnOverlayPress && allowDismissOnInteraction && !allowBackgroundInteraction
      if (canDismissFromOverlay) {
        overlay.isClickable = true
        overlay.setOnClickListener { dismissSheet() }
      } else {
        overlay.isClickable = false
        overlay.setOnClickListener(null)
      }
    }
    applyOverlayInteractionMode()
  }

  private fun applyWindowInteractionMode() {
    val win = window ?: return
    enforceNoSystemDim()
    if (allowBackgroundInteraction) {
      win.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL)
      win.setGravity(Gravity.BOTTOM)
      val sheetWindowHeight = resolvedSnapHeights.lastOrNull()
      if (sheetWindowHeight != null && sheetWindowHeight > 0) {
        win.setLayout(WindowManager.LayoutParams.MATCH_PARENT, sheetWindowHeight)
      } else {
        win.setLayout(
          WindowManager.LayoutParams.MATCH_PARENT,
          WindowManager.LayoutParams.WRAP_CONTENT,
        )
      }
    } else {
      win.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL)
      win.setLayout(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
      )
    }
    setCanceledOnTouchOutside(false)
    applyCoordinatorPassThroughMode()
  }

  private fun enforceNoSystemDim() {
    val win = window ?: return
    win.setDimAmount(0f)
    win.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
  }

  private fun applyOverlayInteractionMode() {
    val overlay = overlayView ?: return
    val params = overlay.layoutParams
    if (overlayDefaultWidth == null || overlayDefaultHeight == null) {
      overlayDefaultWidth = params?.width
      overlayDefaultHeight = params?.height
    }

    if (allowBackgroundInteraction) {
      detachOverlayFromParentIfNeeded()
      overlay.visibility = View.GONE
      overlay.alpha = 0f
      overlay.isClickable = false
      overlay.isEnabled = false
      overlay.isFocusable = false
      overlay.setOnClickListener(null)
      if (params != null && (params.width != 0 || params.height != 0)) {
        params.width = 0
        params.height = 0
        overlay.layoutParams = params
      }
      return
    }

    restoreOverlayToParentIfNeeded()
    overlay.isEnabled = true
    if (params != null) {
      val defaultWidth = overlayDefaultWidth
      val defaultHeight = overlayDefaultHeight
      if (defaultWidth != null && defaultHeight != null) {
        if (params.width != defaultWidth || params.height != defaultHeight) {
          params.width = defaultWidth
          params.height = defaultHeight
          overlay.layoutParams = params
        }
      } else if (params.width == 0 || params.height == 0) {
        params.width = ViewGroup.LayoutParams.MATCH_PARENT
        params.height = ViewGroup.LayoutParams.MATCH_PARENT
        overlay.layoutParams = params
      }
    }
  }

  private fun captureOverlayParentIfNeeded() {
    if (overlayParent != null) return
    val overlay = overlayView ?: return
    val parent = overlay.parent as? ViewGroup ?: return
    overlayParent = parent
    overlayParentIndex = parent.indexOfChild(overlay).coerceAtLeast(0)
  }

  private fun detachOverlayFromParentIfNeeded() {
    val overlay = overlayView ?: return
    val parent = overlay.parent as? ViewGroup ?: return
    if (overlayParent == null) {
      overlayParent = parent
      overlayParentIndex = parent.indexOfChild(overlay).coerceAtLeast(0)
    }
    parent.removeView(overlay)
  }

  private fun restoreOverlayToParentIfNeeded() {
    val overlay = overlayView ?: return
    if (overlay.parent != null) return
    val parent = overlayParent ?: return
    val index = overlayParentIndex.coerceAtLeast(0).coerceAtMost(parent.childCount)
    parent.addView(overlay, index)
  }

  private fun applyCoordinatorPassThroughMode() {
    val container = sheetContainer ?: return
    val coordinator = container.parent as? View ?: return
    if (!allowBackgroundInteraction) {
      forwardingOutsideGesture = false
      coordinator.setOnTouchListener(null)
      return
    }
    coordinator.setOnTouchListener { _, event ->
      val sheet = sheetContainer ?: return@setOnTouchListener false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          val inside = isPointInsideView(event.rawX, event.rawY, sheet)
          forwardingOutsideGesture = !inside
          if (forwardingOutsideGesture) {
            dispatchTouchToActivity(event)
            true
          } else {
            false
          }
        }
        MotionEvent.ACTION_MOVE,
        MotionEvent.ACTION_UP,
        MotionEvent.ACTION_CANCEL -> {
          if (!forwardingOutsideGesture) {
            return@setOnTouchListener false
          }
          dispatchTouchToActivity(event)
          if (event.actionMasked == MotionEvent.ACTION_UP ||
            event.actionMasked == MotionEvent.ACTION_CANCEL
          ) {
            forwardingOutsideGesture = false
          }
          true
        }
        else -> false
      }
    }
  }

  private fun isPointInsideView(rawX: Float, rawY: Float, view: View): Boolean {
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    val left = location[0].toFloat()
    val top = location[1].toFloat()
    val right = left + view.width.toFloat()
    val bottom = top + view.height.toFloat()
    return rawX >= left && rawX <= right && rawY >= top && rawY <= bottom
  }

  private fun dispatchTouchToActivity(event: MotionEvent) {
    val activity = findActivity() ?: return
    val decor = activity.window?.decorView ?: return
    val location = IntArray(2)
    decor.getLocationOnScreen(location)
    val copy = MotionEvent.obtain(event)
    copy.setLocation(event.rawX - location[0], event.rawY - location[1])
    decor.dispatchTouchEvent(copy)
    copy.recycle()
  }

  private fun findActivity(): Activity? {
    var current: Context? = context
    while (current is ContextWrapper) {
      if (current is Activity) return current
      current = current.baseContext
    }
    return null
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
      params.height = maxHeight
      container.layoutParams = params
      container.requestLayout()
      (container.parent as? View)?.requestLayout()
    }
    val hostParams = contentHost.layoutParams
    if (hostParams == null) {
      contentHost.layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, maxHeight)
    } else {
      hostParams.height = maxHeight
      contentHost.layoutParams = hostParams
    }
    contentHost.requestLayout()
    restorePendingHeightIfNeeded()
    applyWindowInteractionMode()
  }

  private fun prepareEntranceState(state: BottomSheetBehavior<FrameLayout>) {
    state.isFitToContents = false
    state.skipCollapsed = false
    state.setPeekHeight(0, false)
    state.state = BottomSheetBehavior.STATE_COLLAPSED
  }

  private fun updateOverlayProgress(sheet: View) {
    if (allowBackgroundInteraction || overlayOpacity <= 0f) {
      lastOverlayProgress = 0f
      overlayView?.let {
        it.visibility = View.GONE
        it.alpha = 0f
      }
      return
    }
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
    val index = pendingIndexRestore ?: return
    pendingIndexRestore = null
    applyStateForIndex(index)
    commitPendingExpandedOffset()
  }

  private fun resolveDynamicHeightCap(): Int {
    if (!dynamicContentHeight) {
      return screenHeight
    }
    val measured = measureContentHeight().coerceAtLeast(0)
    if (measured > 0) {
      measuredContentHeight = measured
    }
    val hintedHeight = contentHeightHintPx?.takeIf { it > 0 } ?: 0
    val sourceHeight = maxOf(measuredContentHeight, hintedHeight)
    val cappedContentHeight = sourceHeight
      .takeIf { it > 0 }
      ?.coerceAtMost(screenHeight)
      ?: screenHeight
    return cappedContentHeight.coerceAtLeast(1)
  }

  private fun measureContentHeight(): Int {
    if (contentHost.childCount == 0) return 0
    var bottomMost = 0
    for (index in 0 until contentHost.childCount) {
      val child = contentHost.getChildAt(index) ?: continue
      val childBottom = measureDeepestVisibleBottom(child)
      if (childBottom > bottomMost) {
        bottomMost = childBottom
      }
    }
    val padded = bottomMost + contentHost.paddingBottom
    return padded.coerceAtLeast(0)
  }

  private fun measureDeepestVisibleBottom(view: View): Int {
    if (view.visibility == View.GONE || view.alpha <= 0f) {
      return 0
    }

    if (view is ViewGroup && view.childCount > 0) {
      var descendantBottom = 0
      for (index in 0 until view.childCount) {
        val child = view.getChildAt(index) ?: continue
        val childBottom = measureDeepestVisibleBottom(child)
        if (childBottom > descendantBottom) {
          descendantBottom = childBottom
        }
      }
      if (descendantBottom > 0) {
        return descendantBottom
      }
    }

    val rect = Rect()
    view.getDrawingRect(rect)
    contentHost.offsetDescendantRectToMyCoords(view, rect)
    val layoutParams = view.layoutParams as? ViewGroup.MarginLayoutParams
    return rect.bottom + (layoutParams?.bottomMargin ?: 0)
  }

  private fun handleContentLayoutChanged() {
    if (!dynamicContentHeight || !isShowing) {
      return
    }
    val measuredHeight = measureContentHeight().coerceAtLeast(0)
    val hintedHeight = contentHeightHintPx?.takeIf { it > 0 } ?: 0
    val nextHeight = maxOf(measuredHeight, hintedHeight)
    if (nextHeight <= 0 || abs(nextHeight - measuredContentHeight) <= 1) {
      return
    }
    measuredContentHeight = nextHeight
    val previousHeights = resolvedSnapHeights
    configureBehavior()
    if (previousHeights != resolvedSnapHeights) {
      applyStateForIndex(currentSnapIndex)
    }
  }

  private fun attachGlobalLayoutListener() {
    if (isGlobalLayoutListenerAttached) return
    val observer = contentHost.viewTreeObserver
    if (!observer.isAlive) return
    observer.addOnGlobalLayoutListener(contentGlobalLayoutListener)
    isGlobalLayoutListenerAttached = true
  }

  private fun detachGlobalLayoutListener() {
    if (!isGlobalLayoutListenerAttached) return
    val observer = contentHost.viewTreeObserver
    if (observer.isAlive) {
      observer.removeOnGlobalLayoutListener(contentGlobalLayoutListener)
    }
    isGlobalLayoutListenerAttached = false
  }

  private fun applyExpandedOffset(offset: Int) {
    val behavior = behavior ?: return
    if (pendingIndexRestore != null && behavior.state == BottomSheetBehavior.STATE_EXPANDED) {
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

  private fun scheduleCloseFallback() {
    cancelCloseFallback()
    val generation = ++closeFallbackGeneration
    var framesRemaining = 24
    val callback = object : Choreographer.FrameCallback {
      override fun doFrame(frameTimeNanos: Long) {
        if (generation != closeFallbackGeneration) return
        if (!isShowing) return
        val behavior = behavior ?: return
        if (behavior.state == BottomSheetBehavior.STATE_HIDDEN) return
        if (framesRemaining <= 0) {
          dismiss()
          return
        }
        framesRemaining -= 1
        Choreographer.getInstance().postFrameCallback(this)
      }
    }
    closeFallbackFrameCallback = callback
    Choreographer.getInstance().postFrameCallback(callback)
  }

  private fun cancelCloseFallback() {
    closeFallbackGeneration += 1
    val callback = closeFallbackFrameCallback ?: return
    Choreographer.getInstance().removeFrameCallback(callback)
    closeFallbackFrameCallback = null
  }

  private fun updateCurrentIndex(sheet: View, state: Int) {
    currentSnapIndex = when {
      resolvedSnapHeights.isEmpty() -> 0
      resolvedSnapHeights.size == 1 -> 0
      resolvedSnapHeights.size == 2 -> when (state) {
        BottomSheetBehavior.STATE_EXPANDED -> 1
        BottomSheetBehavior.STATE_COLLAPSED -> 0
        else -> nearestIndexForHeight(visibleHeightForSheet(sheet))
      }
      else -> when (state) {
        BottomSheetBehavior.STATE_COLLAPSED -> 0
        BottomSheetBehavior.STATE_HALF_EXPANDED -> 1
        BottomSheetBehavior.STATE_EXPANDED -> 2
        else -> nearestIndexForHeight(visibleHeightForSheet(sheet))
      }
    }
  }
}
