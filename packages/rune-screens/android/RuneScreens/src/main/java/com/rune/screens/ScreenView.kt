package com.rune.screens

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Log
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.animation.AccelerateInterpolator
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
        private const val ZOOM_SCALE_START = 0.92f
        private const val DIM_MAX_ALPHA = 0.15f
    }

    /** Reference to parent container */
    internal var container: ScreenContainerView? = null

    /** Unique key for this screen */
    var screenKey: String = ""
        private set

    /** Whether this screen is active (should be in the visible stack) */
    var isScreenActive: Boolean = false
        private set

    /** Animation type for this screen */
    var animation: ScreenAnimation = ScreenAnimation.PUSH
        private set

    /** Whether back gesture is enabled */
    var gestureEnabled: Boolean = true
        private set

    /** Whether this screen is currently transitioning */
    var isInTransition: Boolean = false
        private set

    /** Current animator (if running) */
    private var currentAnimator: Animator? = null

    // Event callbacks
    var onWillAppear: (() -> Unit)? = null
    var onDidAppear: (() -> Unit)? = null
    var onWillDisappear: (() -> Unit)? = null
    var onDidDisappear: (() -> Unit)? = null

    private val fastOutSlowIn = FastOutSlowInInterpolator()

    // Dim overlay paint
    private val dimPaint = Paint().apply {
        color = Color.BLACK
        alpha = 0
    }
    private var dimAlpha: Int = 0

    init {
        visibility = View.GONE
        clipChildren = false
        clipToPadding = false
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        Log.d(TAG, "onAttachedToWindow: $screenKey")
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        Log.d(TAG, "onMeasure: $screenKey - Measured: $measuredWidth x $measuredHeight")
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        if (changed) {
            Log.d(TAG, "onLayout: $screenKey - frame=($left, $top, $right, $bottom)")
        }
    }

    fun setScreenKey(key: String) {
        this.screenKey = key
        Log.d(TAG, "Screen key set: $key")
    }

    fun setActive(active: Boolean) {
        if (isScreenActive == active) return
        
        val wasActive = isScreenActive
        isScreenActive = active
        
        Log.d(TAG, "Screen $screenKey active: $wasActive -> $active")
        
        if (active && !wasActive) {
            performEnterAnimation()
        } else if (!active && wasActive) {
            performExitAnimation()
        }
    }

    fun setAnimationType(type: String?) {
        animation = ScreenAnimation.fromString(type)
    }

    fun setGestureEnabled(enabled: Boolean) {
        gestureEnabled = enabled
    }

    override fun setVisibility(visibility: Int) {
        val visString = when(visibility) {
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

    /**
     * Called by ScreenContainerView when this view is being removed but needs to animate out first.
     */
    fun startExitAnimationAndCleanup() {
        Log.d(TAG, "startExitAnimationAndCleanup: $screenKey")
        // Ensure we are marked inactive so logic knows we are exiting
        isScreenActive = false
        
        // Force the animation to run with a cleanup callback
        performExitAnimation(isDetaching = true)
    }

    private fun cancelAnimation() {
        currentAnimator?.cancel()
        currentAnimator = null
    }

    /**
     * Helper to find the previous screen (the one below this one)
     */
    private fun getPreviousScreen(): ScreenView? {
        val container = container ?: return null
        
        // Case 1: I am in the main stack
        val myIndex = container.screens.indexOf(this)
        if (myIndex != -1) {
            if (myIndex > 0) return container.screens[myIndex - 1]
            return null
        }
        
        // Case 2: I am detaching (removed from screens list)
        // The screen below me is the current top of the stack
        return container.screens.lastOrNull()
    }

    private fun performEnterAnimation() {
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
        
        when (animation) {
            ScreenAnimation.PUSH -> {
                // Incoming: Slide from Right to Center, Fade In
                translationX = offsetPx
                alpha = 0f
                
                animators.add(ObjectAnimator.ofFloat(this, "translationX", 0f))
                animators.add(ObjectAnimator.ofFloat(this, "alpha", 1f))
                
                // Outgoing: Slide from Center to Left, Fade Out
                animatePreviousScreenOnEnter(animators, -offsetPx)
            }
            ScreenAnimation.ZOOM -> {
                scaleX = ZOOM_SCALE_START
                scaleY = ZOOM_SCALE_START
                alpha = 0f
                animators.add(ObjectAnimator.ofFloat(this, "scaleX", 1f))
                animators.add(ObjectAnimator.ofFloat(this, "scaleY", 1f))
                animators.add(ObjectAnimator.ofFloat(this, "alpha", 1f))
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
        val previousScreen = getPreviousScreen() ?: return
        
        previousScreen.isInTransition = true
        previousScreen.setLayerType(LAYER_TYPE_HARDWARE, null)
        
        animators.add(ObjectAnimator.ofFloat(previousScreen, "translationX", targetTranslationX))
        animators.add(ObjectAnimator.ofFloat(previousScreen, "alpha", 0f))
    }

    private fun performExitAnimation(isDetaching: Boolean = false) {
        cancelAnimation()
        onWillDisappear?.invoke()
        
        if (animation == ScreenAnimation.NONE) {
            visibility = View.GONE
            resetTransforms()
            container?.updateScreenVisibility()
            onDidDisappear?.invoke()
            if (isDetaching) container?.finishRemoval(this)
            return
        }
        
        isInTransition = true
        setLayerType(LAYER_TYPE_HARDWARE, null)
        
        val animators = mutableListOf<Animator>()
        val density = context.resources.displayMetrics.density
        val offsetPx = SHARED_AXIS_OFFSET_DP * density
        
        when (animation) {
            ScreenAnimation.PUSH -> {
                // Outgoing: Slide from Center to Right, Fade Out
                animators.add(ObjectAnimator.ofFloat(this, "translationX", offsetPx))
                animators.add(ObjectAnimator.ofFloat(this, "alpha", 0f))
                
                // Incoming: Slide from Left to Center, Fade In
                animatePreviousScreenOnExit(animators, -offsetPx)
            }
            ScreenAnimation.ZOOM -> {
                animators.add(ObjectAnimator.ofFloat(this, "scaleX", ZOOM_SCALE_START))
                animators.add(ObjectAnimator.ofFloat(this, "scaleY", ZOOM_SCALE_START))
                animators.add(ObjectAnimator.ofFloat(this, "alpha", 0f))
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
                    // Capture container before potential cleanup
                    val currentContainer = container

                    if (isDetaching) {
                        // CRITICAL: Remove from container lists FIRST to prevent
                        // updateScreenVisibility from seeing it and forcing it VISIBLE
                        // after resetTransforms() makes it opaque.
                        currentContainer?.finishRemoval(this@ScreenView)
                    }

                    visibility = View.GONE
                    resetTransforms()
                    isInTransition = false
                    setLayerType(LAYER_TYPE_NONE, null)
                    
                    currentContainer?.updateScreenVisibility()
                    onDidDisappear?.invoke()
                    currentAnimator = null
                }
                
                override fun onAnimationCancel(animation: Animator) {
                    val currentContainer = container
                    if (isDetaching) {
                        currentContainer?.finishRemoval(this@ScreenView)
                    }
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
        
        previousScreen.isInTransition = true
        previousScreen.visibility = View.VISIBLE
        previousScreen.setLayerType(LAYER_TYPE_HARDWARE, null)
        
        // Reset previous screen state for re-entry
        previousScreen.translationX = startTranslationX
        previousScreen.alpha = 0f
        
        animators.add(ObjectAnimator.ofFloat(previousScreen, "translationX", 0f).apply {
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    previousScreen.isInTransition = false
                    previousScreen.setLayerType(LAYER_TYPE_NONE, null)
                    // Ensure visibility is correct after transition
                    previousScreen.container?.updateScreenVisibility()
                }
            })
        })
        animators.add(ObjectAnimator.ofFloat(previousScreen, "alpha", 1f))
    }

    private fun resetTransforms() {
        translationX = 0f
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
