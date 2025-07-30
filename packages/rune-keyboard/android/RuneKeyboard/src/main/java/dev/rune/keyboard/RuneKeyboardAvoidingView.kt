package dev.rune.keyboard

import android.content.Context
import android.os.Build
import android.view.View
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat

enum class KeyboardAvoidingBehavior {
    PADDING,
    POSITION,
    HEIGHT
}

class RuneKeyboardAvoidingView(context: Context) : FrameLayout(context) {

    private var behavior: KeyboardAvoidingBehavior = KeyboardAvoidingBehavior.PADDING
    private var keyboardVerticalOffset: Float = 0f
    private var isKeyboardEnabled: Boolean = true
    private var currentKeyboardHeight: Float = 0f
    private var isAttached = false

    init {
        clipChildren = true
        clipToPadding = false
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isAttached = true
        setupKeyboardListener()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        isAttached = false
    }

    fun setBehavior(behaviorString: String) {
        behavior = when (behaviorString.lowercase()) {
            "padding" -> KeyboardAvoidingBehavior.PADDING
            "position" -> KeyboardAvoidingBehavior.POSITION
            "height" -> KeyboardAvoidingBehavior.HEIGHT
            else -> KeyboardAvoidingBehavior.PADDING
        }
    }

    fun setKeyboardVerticalOffset(offset: Float) {
        keyboardVerticalOffset = offset
    }

    fun setKeyboardEnabled(enabled: Boolean) {
        isKeyboardEnabled = enabled
        if (!enabled) {
            resetLayout()
        }
    }

    fun cleanup() {
        resetLayout()
    }

    private fun setupKeyboardListener() {
        val density = resources.displayMetrics.density

        // Use WindowInsetsAnimation for smooth keyboard tracking (API 30+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ViewCompat.setWindowInsetsAnimationCallback(
                this,
                object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    override fun onProgress(
                        insets: WindowInsetsCompat,
                        runningAnimations: MutableList<WindowInsetsAnimationCompat>
                    ): WindowInsetsCompat {
                        if (!isKeyboardEnabled) return insets

                        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                        val imeHeight = imeInsets.bottom / density
                        val isVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

                        currentKeyboardHeight = if (isVisible) imeHeight else 0f
                        applyAdjustment(currentKeyboardHeight + keyboardVerticalOffset)

                        return insets
                    }

                    override fun onEnd(animation: WindowInsetsAnimationCompat) {
                        super.onEnd(animation)
                        
                        if (!isKeyboardEnabled) return

                        val insets = ViewCompat.getRootWindowInsets(this@RuneKeyboardAvoidingView) ?: return
                        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                        val imeHeight = imeInsets.bottom / density
                        val isVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

                        currentKeyboardHeight = if (isVisible) imeHeight else 0f
                        applyAdjustment(if (isVisible) currentKeyboardHeight + keyboardVerticalOffset else 0f)
                    }
                }
            )
        }

        // Fallback for older APIs
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            if (!isKeyboardEnabled) return@setOnApplyWindowInsetsListener insets

            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            val imeHeight = imeInsets.bottom / density
            val isVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

            currentKeyboardHeight = if (isVisible) imeHeight else 0f
            applyAdjustment(if (isVisible) currentKeyboardHeight + keyboardVerticalOffset else 0f)

            insets
        }
    }

    private fun applyAdjustment(overlap: Float) {
        val overlapPx = (overlap * resources.displayMetrics.density).toInt()
        
        when (behavior) {
            KeyboardAvoidingBehavior.PADDING -> {
                setPadding(paddingLeft, paddingTop, paddingRight, overlapPx)
            }
            KeyboardAvoidingBehavior.POSITION -> {
                translationY = -overlapPx.toFloat()
            }
            KeyboardAvoidingBehavior.HEIGHT -> {
                setPadding(paddingLeft, paddingTop, paddingRight, overlapPx)
            }
        }
    }

    private fun resetLayout() {
        translationY = 0f
        setPadding(paddingLeft, paddingTop, paddingRight, 0)
        currentKeyboardHeight = 0f
    }
}
