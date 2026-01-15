package com.zynth.components.glass

import android.content.Context
import android.view.MotionEvent
import androidx.dynamicanimation.animation.DynamicAnimation
import androidx.dynamicanimation.animation.SpringAnimation
import androidx.dynamicanimation.animation.SpringForce
import com.zynth.components.view.ZynthViewContainer

/**
 * A container that implements the "Glass" interaction behavior:
 * - Scales up on touch (1.1x).
 * - Moves slightly towards the touch point (parallax/tilt effect).
 * - Uses Spring animations for fluid motion.
 */
class ZynthGlassView(context: Context) : ZynthViewContainer(context) {

    private var interactive: Boolean = true
    
    // Helper to create configured spring
    private fun createSpringAnimation(property: androidx.dynamicanimation.animation.FloatPropertyCompat<android.view.View>): SpringAnimation {
        return SpringAnimation(this, property).apply {
            spring = SpringForce().apply {
                dampingRatio = 0.9f
                stiffness = 1400f // Fast Spatial
            }
        }
    }

    private val scaleXSpring = createSpringAnimation(DynamicAnimation.SCALE_X)
    private val scaleYSpring = createSpringAnimation(DynamicAnimation.SCALE_Y)
    private val translationXSpring = createSpringAnimation(DynamicAnimation.TRANSLATION_X)
    private val translationYSpring = createSpringAnimation(DynamicAnimation.TRANSLATION_Y)

    // Maximum translation in pixels (approx 15dp)
    private val maxTranslationPx: Float

    init {
        val density = context.resources.displayMetrics.density
        maxTranslationPx = 15f * density
    }

    fun setInteractive(interactive: Boolean) {
        this.interactive = interactive
    }

    private fun handleTouch(event: MotionEvent) {
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                // Scale up to 1.1 (add 0.1)
                scaleXSpring.animateToFinalPosition(1.1f)
                scaleYSpring.animateToFinalPosition(1.1f)
                
                updateTranslation(event.x, event.y)
            }
            MotionEvent.ACTION_MOVE -> {
                updateTranslation(event.x, event.y)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                // Reset to default
                scaleXSpring.animateToFinalPosition(1f)
                scaleYSpring.animateToFinalPosition(1f)
                translationXSpring.animateToFinalPosition(0f)
                translationYSpring.animateToFinalPosition(0f)
            }
        }
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        // "Spy" on events: Animate regardless of whether a child consumes the event
        if (interactive) {
            handleTouch(event)
        }
        return super.dispatchTouchEvent(event)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        // Respect pointerEvents mode from parent
        if (pointerMode == com.zynth.components.view.ZynthViewContainer.PointerEventsMode.NONE || 
            pointerMode == com.zynth.components.view.ZynthViewContainer.PointerEventsMode.BOX_NONE) {
            return false
        }

        if (!interactive) return super.onTouchEvent(event)

        // If we reach here, no child consumed the event, so we consume it to track the gesture
        // Animation is already handled in dispatchTouchEvent
        
        if (event.action == MotionEvent.ACTION_UP) {
            performClick()
        }
        return true
    }

    private fun updateTranslation(touchX: Float, touchY: Float) {
        val w = width
        val h = height
        if (w == 0 || h == 0) return

        val centerX = w / 2f
        val centerY = h / 2f

        val dx = touchX - centerX
        val dy = touchY - centerY

        // Normalize to [-1, 1] relative to center
        val normX = (dx / centerX).coerceIn(-1f, 1f)
        val normY = (dy / centerY).coerceIn(-1f, 1f)

        // Calculate target translation
        val targetX = normX * maxTranslationPx
        val targetY = normY * maxTranslationPx

        translationXSpring.animateToFinalPosition(targetX)
        translationYSpring.animateToFinalPosition(targetY)
    }
}
