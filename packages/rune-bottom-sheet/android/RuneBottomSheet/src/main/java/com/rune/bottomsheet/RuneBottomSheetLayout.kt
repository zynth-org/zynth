package com.rune.bottomsheet

import android.content.Context
import android.util.AttributeSet
import android.view.View
import androidx.coordinatorlayout.widget.CoordinatorLayout

/**
 * Skeleton layout to keep the RuneBottomSheet component functional while native behavior is reworked.
 */
class RuneBottomSheetLayout @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
) : CoordinatorLayout(context, attrs, defStyleAttr) {

  private var snapChangedListener: ((Int, Float) -> Unit)? = null
  private var dismissListener: (() -> Unit)? = null
  private var openListener: ((Boolean) -> Unit)? = null
  private var currentOptions = RuneBottomSheetOptions()

  init {
    // Placeholder for view hierarchy (scrim, sheet host, behaviors).
  }

  fun setSheetContent(view: View) {
    // Native child placement will move here in a future iteration.
  }

  fun setSnapChangedListener(listener: (Int, Float) -> Unit) {
    snapChangedListener = listener
  }

  fun setOnDismissListener(listener: () -> Unit) {
    dismissListener = listener
  }

  fun setOnOpenChangeListener(listener: (Boolean) -> Unit) {
    openListener = listener
  }

  fun applyLayoutOptions(options: RuneBottomSheetOptions?) {
    currentOptions = options ?: RuneBottomSheetOptions()
  }

  fun updateLayoutOptions(transform: RuneBottomSheetOptions.() -> RuneBottomSheetOptions) {
    applyLayoutOptions(transform(currentOptions))
  }

  fun setOverlayColor(color: Int) {
    // Overlay color handling will be added when the visuals are restored.
  }

  fun setOverlayOpacity(opacity: Float) {
    // Placeholder for opacity animation support.
  }

  fun setDismissOnOverlayPress(enabled: Boolean) {
    // Hook up overlay dismissal once the overlay exists.
  }

  fun open(index: Int? = null) {
    snapChangedListener?.invoke(index ?: currentOptions.initialSnapIndex, 0f)
    openListener?.invoke(true)
  }

  fun close() {
    dismissListener?.invoke()
    openListener?.invoke(false)
  }

  fun snapTo(index: Int) {
    snapChangedListener?.invoke(index, 0f)
  }
}

/** Lightweight options holder until we have proper prop parsing again. */
data class RuneBottomSheetOptions(
  val snapPoints: List<String> = emptyList(),
  val overlayColor: Int = 0,
  val overlayOpacity: Float = 0f,
  val dismissOnOverlayPress: Boolean = true,
  val initialSnapIndex: Int = 0,
)
