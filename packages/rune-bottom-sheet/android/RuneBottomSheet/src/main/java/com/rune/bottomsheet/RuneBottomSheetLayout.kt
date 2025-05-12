package com.rune.bottomsheet

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.AttributeSet
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.ColorInt
import androidx.coordinatorlayout.widget.CoordinatorLayout
import com.google.android.material.bottomsheet.BottomSheetBehavior
import kotlin.math.min

class RuneBottomSheetLayout @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
) : CoordinatorLayout(context, attrs, defStyleAttr) {

  private val scrim: View
  private val sheetHost: FrameLayout
  private val bottomSheetBehavior = BottomSheetBehavior<FrameLayout>()
  private val snapPoints = mutableListOf<BottomSheetSnapPoint>()
  private var overlayOpacity = 0.5f
  private var dismissOnOverlayPress = true
  private var onSnapChanged: ((Int, Float) -> Unit)? = null
  private var onDismissRequest: (() -> Unit)? = null
  private var currentOptions = RuneBottomSheetOptions()

  init {
    if (layoutParams == null) {
      layoutParams = LayoutParams(
        LayoutParams.MATCH_PARENT,
        LayoutParams.MATCH_PARENT,
      )
    }

    clipToPadding = false

    scrim = View(context).apply {
      setBackgroundColor(Color.BLACK)
      alpha = 0f
      visibility = View.GONE
      isClickable = true
      isFocusable = true
    }
    super.addView(scrim, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

    val sheetBackground = GradientDrawable().apply {
      setColor(Color.WHITE)
      cornerRadius = resources.displayMetrics.density * 16f
    }

    sheetHost = FrameLayout(context).apply {
      background = sheetBackground
      clipToPadding = false
      elevation = resources.displayMetrics.density * 10f
    }

    val sheetParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
      gravity = Gravity.BOTTOM
      behavior = bottomSheetBehavior
    }
    super.addView(sheetHost, sheetParams)

    bottomSheetBehavior.peekHeight = 0
    bottomSheetBehavior.isFitToContents = false
    bottomSheetBehavior.isHideable = true
    bottomSheetBehavior.state = BottomSheetBehavior.STATE_COLLAPSED
    bottomSheetBehavior.addBottomSheetCallback(object : BottomSheetBehavior.BottomSheetCallback() {
      override fun onStateChanged(bottomSheet: View, newState: Int) {
        updateScrimVisibility(newState)
        if (newState == BottomSheetBehavior.STATE_HIDDEN) {
          onDismissRequest?.invoke()
        }
      }

      override fun onSlide(bottomSheet: View, slideOffset: Float) {
        if (slideOffset >= 0f) {
          scrim.visibility = View.VISIBLE
          scrim.alpha = (slideOffset * overlayOpacity).coerceIn(0f, 1f)
        }
        onSnapChanged?.invoke(nearestSnapIndex(slideOffset), slideOffset)
      }
    })

    scrim.setOnClickListener {
      if (dismissOnOverlayPress) {
        onDismissRequest?.invoke()
      }
    }
  }

  override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
    routeChild(child, params)
  }

  override fun addView(child: View?, params: ViewGroup.LayoutParams?) {
    routeChild(child, params)
  }

  override fun addView(child: View?, width: Int, height: Int) {
    routeChild(child, FrameLayout.LayoutParams(width, height))
  }

  private fun routeChild(child: View?, params: ViewGroup.LayoutParams?) {
    when (child) {
      null -> return
      scrim, sheetHost -> super.addView(child, params)
      else -> sheetHost.addView(child, params)
    }
  }

  fun setSheetContent(view: View) {
    sheetHost.removeAllViews()
    sheetHost.addView(
      view,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )
  }

  fun setOverlayColor(@ColorInt color: Int) {
    scrim.setBackgroundColor(color)
  }

  fun setOverlayOpacity(opacity: Float) {
    overlayOpacity = opacity.coerceIn(0f, 1f)
  }

  fun setDismissOnOverlayPress(value: Boolean) {
    dismissOnOverlayPress = value
  }

  fun setSnapPoints(points: List<BottomSheetSnapPoint>) {
    snapPoints.clear()
    snapPoints.addAll(points)
    schedulePeekHeightUpdate()
  }

  fun setSnapChangedListener(listener: ((Int, Float) -> Unit)?) {
    onSnapChanged = listener
  }

  fun setOnDismissListener(listener: (() -> Unit)?) {
    onDismissRequest = listener
  }

  fun expandToIndex(index: Int) {
    if (index <= 0) {
      bottomSheetBehavior.state = BottomSheetBehavior.STATE_COLLAPSED
    } else {
      bottomSheetBehavior.state = BottomSheetBehavior.STATE_HALF_EXPANDED
    }
  }

  fun reset() {
    bottomSheetBehavior.state = BottomSheetBehavior.STATE_COLLAPSED
    scrim.alpha = 0f
    scrim.visibility = View.GONE
  }

  private fun nearestSnapIndex(slideOffset: Float): Int {
    if (snapPoints.isEmpty()) return 0
    val normalized = ((slideOffset + 1f) / 2f).coerceIn(0f, 1f)
    val rawIndex = (normalized * snapPoints.size).toInt()
    return min(rawIndex.coerceAtLeast(0), snapPoints.size - 1)
  }

  private fun schedulePeekHeightUpdate() {
    sheetHost.post {
      val containerHeight = height
      if (containerHeight <= 0) return@post
      val peek = snapPoints
        .map { it.resolveHeight(containerHeight, resources.displayMetrics) }
        .maxOrNull() ?: sheetHost.height
      if (peek > 0) {
        bottomSheetBehavior.peekHeight = peek
      }
    }
  }

  private fun updateScrimVisibility(state: Int) {
    scrim.visibility = if (
      state == BottomSheetBehavior.STATE_COLLAPSED ||
        state == BottomSheetBehavior.STATE_HIDDEN
    ) {
      View.GONE
    } else {
      View.VISIBLE
    }
  }

  fun applyLayoutOptions(options: RuneBottomSheetOptions?) {
    val sheetOptions = options ?: RuneBottomSheetOptions()
    currentOptions = sheetOptions
    setOverlayColor(sheetOptions.overlayColor)
    setOverlayOpacity(sheetOptions.overlayOpacity)
    setDismissOnOverlayPress(sheetOptions.dismissOnOverlayPress)
    val parsed = sheetOptions.snapPoints.mapNotNull { BottomSheetSnapPoint.parse(it) }
    if (parsed.isNotEmpty()) {
      setSnapPoints(parsed)
    }
    expandToIndex(sheetOptions.initialIndex)
  }

  internal fun updateLayoutOptions(transform: RuneBottomSheetOptions.() -> RuneBottomSheetOptions) {
    applyLayoutOptions(transform(currentOptions))
  }
}

sealed interface BottomSheetSnapPoint {
  fun resolveHeight(maxHeight: Int, metrics: android.util.DisplayMetrics): Int

  data class Percent(val ratio: Float) : BottomSheetSnapPoint {
    override fun resolveHeight(maxHeight: Int, metrics: android.util.DisplayMetrics): Int {
      return (maxHeight * ratio).toInt()
    }
  }

  data class Absolute(val dp: Float) : BottomSheetSnapPoint {
    override fun resolveHeight(maxHeight: Int, metrics: android.util.DisplayMetrics): Int {
      return android.util.TypedValue.applyDimension(
        android.util.TypedValue.COMPLEX_UNIT_DIP,
        dp,
        metrics,
      ).toInt()
    }
  }

  companion object {
    fun parse(value: String?): BottomSheetSnapPoint? {
      if (value.isNullOrBlank()) return null
      val trimmed = value.trim()
      return when {
        trimmed.endsWith("%") -> {
          val number = trimmed.dropLast(1).toFloatOrNull()
          number?.let { Percent((it / 100f).coerceIn(0f, 1f)) }
        }
        else -> trimmed.toFloatOrNull()?.let { Absolute(it.coerceAtLeast(0f)) }
      }
    }
  }
}

data class RuneBottomSheetOptions(
  val snapPoints: List<String> = listOf("40%", "83%"),
  val overlayColor: Int = Color.BLACK,
  val overlayOpacity: Float = 0.58f,
  val dismissOnOverlayPress: Boolean = true,
  val initialIndex: Int = 0,
)
