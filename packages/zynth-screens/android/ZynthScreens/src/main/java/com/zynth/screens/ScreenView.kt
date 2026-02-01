package com.zynth.screens

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Log
import android.view.View
import android.widget.FrameLayout
import androidx.interpolator.view.animation.FastOutSlowInInterpolator

/**
 * A screen primitive that handles its own animations and visibility.
 */
class ScreenView(context: Context) : FrameLayout(context) {

  companion object {
    private const val TAG = "ScreenView"
    private const val ANIMATION_DURATION_MS = 300L
    private const val SHARED_AXIS_OFFSET_DP = 30f
    private const val MODAL_OFFSET_DP = 80f
    private const val ZOOM_SCALE_START = 0.92f
  }

  internal var container: ScreenContainerView? = null
    set(value) {
      field = value
      if (canApplyActiveState()) {
        applyPendingActiveState()
      }
    }

  var screenKey: String = ""
    private set

  var isScreenActive: Boolean = false
    private set

  var animation: ScreenAnimation = ScreenAnimation.PUSH
    private set

  var gestureEnabled: Boolean = true
    private set

  var isInTransition: Boolean = false
    private set

  private var pendingActiveState: Boolean? = null
  private var currentAnimator: Animator? = null

  var onWillAppear: (() -> Unit)? = null
  var onDidAppear: (() -> Unit)? = null
  var onWillDisappear: (() -> Unit)? = null
  var onDidDisappear: (() -> Unit)? = null

  private val fastOutSlowIn = FastOutSlowInInterpolator()
  private var isControlledByNeighbor = false

  private val dimPaint = Paint().apply {
    color = Color.BLACK
    alpha = 0
  }
  private var dimAlpha: Int = 0

  init {
    visibility = View.GONE
    clipChildren = false
    clipToPadding = false
    isClickable = true
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    Log.d(TAG, "onAttachedToWindow: $screenKey")
    applyPendingActiveState()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    Log.d(TAG, "onMeasure: $screenKey - Measured: $measuredWidth x $measuredHeight")
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // Preserve Yoga-driven child layouts set by the UI manager.
    for (i in 0 until childCount) {
      val child = getChildAt(i)
      child.layout(child.left, child.top, child.right, child.bottom)
    }
    if (changed) {
      Log.d(TAG, "onLayout: $screenKey - frame=($left, $top, $right, $bottom)")
    }
  }

  fun setScreenKey(key: String) {
    this.screenKey = key
  }

  fun setActive(active: Boolean) {
    pendingActiveState = active

    if (!canApplyActiveState()) return
    applyPendingActiveState()
  }

  fun setAnimationType(type: String?) {
    animation = ScreenAnimation.fromString(type)
  }

  fun setGestureEnabled(enabled: Boolean) {
    gestureEnabled = enabled
  }

  override fun setVisibility(visibility: Int) {
    val visString = when (visibility) {
      View.VISIBLE -> "VISIBLE"
      View.INVISIBLE -> "INVISIBLE"
      View.GONE -> "GONE"
      else -> visibility.toString()
    }
    if (this.visibility != visibility) {
      Log.d(TAG, "setVisibility: $screenKey -> $visString")
    }
    super.setVisibility(visibility)
  }

  fun startExitAnimationAndCleanup() {
    Log.d(TAG, "startExitAnimationAndCleanup: $screenKey")
    isScreenActive = false
    performExitAnimation(isDetaching = true)
  }

  private fun cancelAnimation() {
    currentAnimator?.cancel()
    currentAnimator = null
  }

  private fun canApplyActiveState(): Boolean {
    return container != null && parent != null
  }

  private fun applyPendingActiveState() {
    if (!canApplyActiveState()) return

    val target = pendingActiveState ?: return
    pendingActiveState = null

    if (isScreenActive == target) return

    val wasActive = isScreenActive
    isScreenActive = target

    Log.d(TAG, "Screen $screenKey active: $wasActive -> $target")

    if (target && !wasActive) {
      performEnterAnimation()
    } else if (!target && wasActive) {
      performExitAnimation()
    }
  }

  private fun getPreviousScreen(): ScreenView? {
    val container = container ?: return null

    val myIndex = container.screens.indexOf(this)
    if (myIndex != -1) {
      if (myIndex > 0) return container.screens[myIndex - 1]
      return null
    }

    return container.screens.lastOrNull()
  }

  private fun performEnterAnimation() {
    if (isControlledByNeighbor) {
      Log.d(TAG, "performEnterAnimation: Skipped because controlled by neighbor")
      return
    }

    val previousScreen = getPreviousScreen()
    if (previousScreen == null) {
      visibility = View.VISIBLE
      resetTransforms()
      container?.updateScreenVisibility()
      onWillAppear?.invoke()
      onDidAppear?.invoke()
      return
    }

    cancelAnimation()
    onWillAppear?.invoke()

    if (animation == ScreenAnimation.NONE) {
      visibility = View.VISIBLE
      resetTransforms()
      container?.updateScreenVisibility()
      onDidAppear?.invoke()
      return
    }

    isInTransition = true
    visibility = View.VISIBLE
    setLayerType(LAYER_TYPE_HARDWARE, null)

    val animators = mutableListOf<Animator>()
    val density = context.resources.displayMetrics.density
    val offsetPx = SHARED_AXIS_OFFSET_DP * density
    val modalOffsetPx = MODAL_OFFSET_DP * density

    when (animation) {
      ScreenAnimation.PUSH -> {
        translationX = offsetPx
        alpha = 0f

        animators.add(ObjectAnimator.ofFloat(this, "translationX", 0f))
        animators.add(ObjectAnimator.ofFloat(this, "alpha", 1f))

        animatePreviousScreenOnEnter(animators, -offsetPx)
      }
      ScreenAnimation.MODAL -> {
        translationY = modalOffsetPx
        alpha = 0f
        animators.add(ObjectAnimator.ofFloat(this, "translationY", 0f))
        animators.add(ObjectAnimator.ofFloat(this, "alpha", 1f))
      }
      ScreenAnimation.ZOOM -> {
        scaleX = ZOOM_SCALE_START
        scaleY = ZOOM_SCALE_START
        alpha = 0f
        animators.add(ObjectAnimator.ofFloat(this, "scaleX", 1f))
        animators.add(ObjectAnimator.ofFloat(this, "scaleY", 1f))
        animators.add(ObjectAnimator.ofFloat(this, "alpha", 1f))

        animatePreviousScreenOnEnterZoom(animators)
      }
      ScreenAnimation.FADE -> {
        alpha = 0f
        animators.add(ObjectAnimator.ofFloat(this, "alpha", 1f))
      }
      else -> {}
    }

    val animatorSet = AnimatorSet().apply {
      playTogether(animators)
      duration = ANIMATION_DURATION_MS
      interpolator = fastOutSlowIn
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          isInTransition = false
          setLayerType(LAYER_TYPE_NONE, null)
          container?.updateScreenVisibility()
          onDidAppear?.invoke()
          currentAnimator = null
        }

        override fun onAnimationCancel(animation: Animator) {
          isInTransition = false
          setLayerType(LAYER_TYPE_NONE, null)
          currentAnimator = null
        }
      })
    }

    currentAnimator = animatorSet
    container?.updateScreenVisibility()
    animatorSet.start()
  }

  private fun animatePreviousScreenOnEnter(animators: MutableList<Animator>, targetTranslationX: Float) {
    val previousScreen = getPreviousScreen()
    if (previousScreen == null) {
      Log.d(TAG, "animatePreviousScreenOnEnter: No previous screen found for $screenKey")
      return
    }

    Log.d(TAG, "animatePreviousScreenOnEnter: animating ${previousScreen.screenKey} out (to x=$targetTranslationX)")

    previousScreen.cancelAnimation()
    previousScreen.isControlledByNeighbor = true
    previousScreen.isInTransition = true

    previousScreen.visibility = View.VISIBLE
    previousScreen.alpha = 1f
    previousScreen.translationX = 0f

    previousScreen.setLayerType(LAYER_TYPE_HARDWARE, null)

    animators.add(ObjectAnimator.ofFloat(previousScreen, "translationX", targetTranslationX))

    val alphaAnim = ObjectAnimator.ofFloat(previousScreen, "alpha", 0f)
    alphaAnim.addListener(object : AnimatorListenerAdapter() {
      override fun onAnimationEnd(animation: Animator) {
        previousScreen.isControlledByNeighbor = false
        previousScreen.isInTransition = false
        previousScreen.setLayerType(LAYER_TYPE_NONE, null)
        previousScreen.container?.updateScreenVisibility()
        previousScreen.translationX = 0f
      }

      override fun onAnimationCancel(animation: Animator) {
        previousScreen.isControlledByNeighbor = false
        previousScreen.isInTransition = false
        previousScreen.setLayerType(LAYER_TYPE_NONE, null)
        previousScreen.container?.updateScreenVisibility()
        previousScreen.translationX = 0f
      }
    })
    animators.add(alphaAnim)
  }

  private fun animatePreviousScreenOnEnterZoom(animators: MutableList<Animator>) {
    val previousScreen = getPreviousScreen()
    if (previousScreen == null) {
      Log.d(TAG, "animatePreviousScreenOnEnterZoom: No previous screen found for $screenKey")
      return
    }

    Log.d(TAG, "animatePreviousScreenOnEnterZoom: animating ${previousScreen.screenKey} out")

    previousScreen.cancelAnimation()
    previousScreen.isControlledByNeighbor = true
    previousScreen.isInTransition = true

    previousScreen.visibility = View.VISIBLE
    previousScreen.alpha = 1f
    previousScreen.scaleX = 1f
    previousScreen.scaleY = 1f

    previousScreen.setLayerType(LAYER_TYPE_HARDWARE, null)

    val scaleXAnim = ObjectAnimator.ofFloat(previousScreen, "scaleX", ZOOM_SCALE_START)
    val scaleYAnim = ObjectAnimator.ofFloat(previousScreen, "scaleY", ZOOM_SCALE_START)
    val alphaAnim = ObjectAnimator.ofFloat(previousScreen, "alpha", 0f)

    alphaAnim.addListener(object : AnimatorListenerAdapter() {
      override fun onAnimationEnd(animation: Animator) {
        previousScreen.isControlledByNeighbor = false
        previousScreen.isInTransition = false
        previousScreen.setLayerType(LAYER_TYPE_NONE, null)
        previousScreen.scaleX = 1f
        previousScreen.scaleY = 1f
        previousScreen.alpha = 1f
        previousScreen.container?.updateScreenVisibility()
      }

      override fun onAnimationCancel(animation: Animator) {
        previousScreen.isControlledByNeighbor = false
        previousScreen.isInTransition = false
        previousScreen.setLayerType(LAYER_TYPE_NONE, null)
        previousScreen.scaleX = 1f
        previousScreen.scaleY = 1f
        previousScreen.alpha = 1f
        previousScreen.container?.updateScreenVisibility()
      }
    })

    animators.add(scaleXAnim)
    animators.add(scaleYAnim)
    animators.add(alphaAnim)
  }

  private fun performExitAnimation(isDetaching: Boolean = false) {
    if (isControlledByNeighbor) {
      Log.d(TAG, "performExitAnimation: Skipped because controlled by neighbor")
      if (isDetaching) {
        container?.finishRemoval(this)
      }
      return
    }

    val nextScreen = getPreviousScreen()

    cancelAnimation()
    onWillDisappear?.invoke()

    if (animation == ScreenAnimation.NONE || nextScreen == null) {
      visibility = View.GONE
      resetTransforms()
      container?.updateScreenVisibility()
      onDidDisappear?.invoke()
      if (isDetaching) {
        container?.finishRemoval(this)
      }
      return
    }

    isInTransition = true
    setLayerType(LAYER_TYPE_HARDWARE, null)

    val animators = mutableListOf<Animator>()
    val density = context.resources.displayMetrics.density
    val offsetPx = SHARED_AXIS_OFFSET_DP * density
    val modalOffsetPx = MODAL_OFFSET_DP * density

    when (animation) {
      ScreenAnimation.PUSH -> {
        animators.add(ObjectAnimator.ofFloat(this, "translationX", offsetPx))
        animators.add(ObjectAnimator.ofFloat(this, "alpha", 0f))

        animatePreviousScreenOnExit(animators, -offsetPx)
      }
      ScreenAnimation.MODAL -> {
        animators.add(ObjectAnimator.ofFloat(this, "translationY", modalOffsetPx))
        animators.add(ObjectAnimator.ofFloat(this, "alpha", 0f))
      }
      ScreenAnimation.ZOOM -> {
        animators.add(ObjectAnimator.ofFloat(this, "scaleX", ZOOM_SCALE_START))
        animators.add(ObjectAnimator.ofFloat(this, "scaleY", ZOOM_SCALE_START))
        animators.add(ObjectAnimator.ofFloat(this, "alpha", 0f))
        animatePreviousScreenOnExitZoom(animators)
      }
      ScreenAnimation.FADE -> {
        animators.add(ObjectAnimator.ofFloat(this, "alpha", 0f))
      }
      else -> {}
    }

    val animatorSet = AnimatorSet().apply {
      playTogether(animators)
      duration = ANIMATION_DURATION_MS
      interpolator = fastOutSlowIn
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          isInTransition = false
          setLayerType(LAYER_TYPE_NONE, null)
          visibility = View.GONE
          resetTransforms()
          container?.updateScreenVisibility()
          onDidDisappear?.invoke()
          currentAnimator = null
          if (isDetaching) {
            container?.finishRemoval(this@ScreenView)
          }
        }

        override fun onAnimationCancel(animation: Animator) {
          isInTransition = false
          setLayerType(LAYER_TYPE_NONE, null)
          currentAnimator = null
        }
      })
    }

    currentAnimator = animatorSet
    container?.updateScreenVisibility()
    animatorSet.start()
  }

  private fun animatePreviousScreenOnExit(animators: MutableList<Animator>, startTranslationX: Float) {
    val previousScreen = getPreviousScreen() ?: return

    previousScreen.cancelAnimation()
    previousScreen.isControlledByNeighbor = true
    previousScreen.isInTransition = true
    previousScreen.visibility = View.VISIBLE
    previousScreen.setLayerType(LAYER_TYPE_HARDWARE, null)

    previousScreen.translationX = startTranslationX
    previousScreen.alpha = 0f

    animators.add(ObjectAnimator.ofFloat(previousScreen, "translationX", 0f).apply {
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          previousScreen.isControlledByNeighbor = false
          previousScreen.isInTransition = false
          previousScreen.setLayerType(LAYER_TYPE_NONE, null)
          previousScreen.container?.updateScreenVisibility()
        }

        override fun onAnimationCancel(animation: Animator) {
          previousScreen.isControlledByNeighbor = false
          previousScreen.isInTransition = false
          previousScreen.setLayerType(LAYER_TYPE_NONE, null)
          previousScreen.container?.updateScreenVisibility()
        }
      })
    })
    animators.add(ObjectAnimator.ofFloat(previousScreen, "alpha", 1f))
  }

  private fun animatePreviousScreenOnExitZoom(animators: MutableList<Animator>) {
    val previousScreen = getPreviousScreen() ?: return

    previousScreen.cancelAnimation()
    previousScreen.isControlledByNeighbor = true
    previousScreen.isInTransition = true
    previousScreen.visibility = View.VISIBLE
    previousScreen.setLayerType(LAYER_TYPE_HARDWARE, null)

    previousScreen.scaleX = ZOOM_SCALE_START
    previousScreen.scaleY = ZOOM_SCALE_START
    previousScreen.alpha = 0f

    val scaleXAnim = ObjectAnimator.ofFloat(previousScreen, "scaleX", 1f)
    val scaleYAnim = ObjectAnimator.ofFloat(previousScreen, "scaleY", 1f)
    val alphaAnim = ObjectAnimator.ofFloat(previousScreen, "alpha", 1f)

    alphaAnim.addListener(object : AnimatorListenerAdapter() {
      override fun onAnimationEnd(animation: Animator) {
        previousScreen.isControlledByNeighbor = false
        previousScreen.isInTransition = false
        previousScreen.setLayerType(LAYER_TYPE_NONE, null)
        previousScreen.scaleX = 1f
        previousScreen.scaleY = 1f
        previousScreen.container?.updateScreenVisibility()
      }

      override fun onAnimationCancel(animation: Animator) {
        previousScreen.isControlledByNeighbor = false
        previousScreen.isInTransition = false
        previousScreen.setLayerType(LAYER_TYPE_NONE, null)
        previousScreen.scaleX = 1f
        previousScreen.scaleY = 1f
        previousScreen.container?.updateScreenVisibility()
      }
    })

    animators.add(scaleXAnim)
    animators.add(scaleYAnim)
    animators.add(alphaAnim)
  }

  private fun resetTransforms() {
    translationX = 0f
    translationY = 0f
    scaleX = 1f
    scaleY = 1f
    alpha = 1f
    dimAlpha = 0
    invalidate()
  }

  fun ensureVisibleState() {
    visibility = View.VISIBLE
    setLayerType(LAYER_TYPE_NONE, null)
    translationX = 0f
    translationY = 0f
    scaleX = 1f
    scaleY = 1f
    alpha = 1f
    dimAlpha = 0
  }

  override fun dispatchDraw(canvas: Canvas) {
    super.dispatchDraw(canvas)
    if (dimAlpha > 0) {
      dimPaint.alpha = dimAlpha
      canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), dimPaint)
    }
  }
}
