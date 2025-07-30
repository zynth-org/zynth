package dev.rune.keyboard

import android.content.Context
import android.os.Build
import android.view.View
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat

class RuneKeyboardStickyView(context: Context) : FrameLayout(context) {

    private var offset: Float = 0f
    private var currentKeyboardHeight: Float = 0f
    private var isAttached = false

    init {
        clipChildren = false
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

    fun setOffset(value: Float) {
        offset = value
        updatePosition()
    }

    fun cleanup() {
        resetPosition()
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
                        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                        val imeHeight = imeInsets.bottom / density
                        val isVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

                        currentKeyboardHeight = if (isVisible) imeHeight else 0f
                        updatePosition()

                        return insets
                    }

                    override fun onEnd(animation: WindowInsetsAnimationCompat) {
                        super.onEnd(animation)
                        
                        val insets = ViewCompat.getRootWindowInsets(this@RuneKeyboardStickyView) ?: return
                        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                        val imeHeight = imeInsets.bottom / density
                        val isVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

                        currentKeyboardHeight = if (isVisible) imeHeight else 0f
                        updatePosition()
                    }
                }
            )
        }

        // Fallback for older APIs
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            val imeHeight = imeInsets.bottom / density
            val isVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

            currentKeyboardHeight = if (isVisible) imeHeight else 0f
            updatePosition()

            insets
        }
    }

    private fun updatePosition() {
        val density = resources.displayMetrics.density
        val keyboardPx = currentKeyboardHeight * density
        val offsetPx = offset * density
        val parentPaddingPx = findAvoidingParentPadding()

        // If the parent already added bottom padding for the keyboard (e.g. KeyboardAvoidingView),
        // only translate by the remaining keyboard height plus any explicit offset.
        val remainingKeyboardPx = (keyboardPx - parentPaddingPx).coerceAtLeast(0f)
        translationY = if (keyboardPx > 0f) -(remainingKeyboardPx + offsetPx) else 0f
    }

    private fun findAvoidingParentPadding(): Float {
        var currentParent = parent
        while (currentParent != null) {
            val currentView = currentParent as? View ?: break
            if (currentView is RuneKeyboardAvoidingView) {
                return currentView.paddingBottom.toFloat()
            }
            currentParent = currentView.parent
        }
        return 0f
    }

    private fun resetPosition() {
        translationY = 0f
        currentKeyboardHeight = 0f
    }
}
