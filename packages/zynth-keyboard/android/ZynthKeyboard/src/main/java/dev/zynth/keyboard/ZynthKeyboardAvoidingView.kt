package dev.zynth.keyboard

import android.content.Context
import android.os.Build
import android.view.View
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.zynth.kit.core.ZynthUIManager

enum class KeyboardAvoidingBehavior {
    PADDING,
    POSITION,
    HEIGHT
}

class ZynthKeyboardAvoidingView(context: Context) : FrameLayout(context) {

    private var behavior: KeyboardAvoidingBehavior = KeyboardAvoidingBehavior.PADDING
    private var keyboardVerticalOffset: Float = 0f
    private var isKeyboardEnabled: Boolean = true
    private var currentKeyboardHeight: Float = 0f
    private var isAttached = false
    private var layoutManager: ZynthUIManager? = null
    private var nodeId: Int = -1
    private var lastAppliedOverlapPx: Float = Float.NaN
    private var lastAppliedBehavior: KeyboardAvoidingBehavior? = null
    private var listenersInstalled = false

    init {
        clipChildren = true
        clipToPadding = false
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isAttached = true
        setupKeyboardListener()
        post { syncWithCurrentInsets() }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        isAttached = false
        detachManager()
    }

    fun attachManager(manager: ZynthUIManager, nodeId: Int) {
        layoutManager = manager
        this.nodeId = nodeId
    }

    fun detachManager() {
        layoutManager = null
        nodeId = -1
    }

    fun getCurrentOverlapPx(): Float {
        return if (lastAppliedOverlapPx.isNaN()) 0f else lastAppliedOverlapPx
    }

    fun setBehavior(behaviorString: String) {
        val newBehavior = when (behaviorString.lowercase()) {
            "padding" -> KeyboardAvoidingBehavior.PADDING
            "position" -> KeyboardAvoidingBehavior.POSITION
            "height" -> KeyboardAvoidingBehavior.HEIGHT
            else -> KeyboardAvoidingBehavior.PADDING
        }
        if (behavior == newBehavior) return
        clearAllBehaviorAdjustments()
        behavior = newBehavior
        lastAppliedOverlapPx = Float.NaN
        lastAppliedBehavior = null
        if (isAttached) {
            post { syncWithCurrentInsets() }
        }
    }

    fun setKeyboardVerticalOffset(offset: Float) {
        if (keyboardVerticalOffset == offset) return
        keyboardVerticalOffset = offset
        if (isAttached) {
            post { syncWithCurrentInsets() }
        }
    }

    fun setKeyboardEnabled(enabled: Boolean) {
        isKeyboardEnabled = enabled
        if (!enabled) {
            resetLayout()
        }
    }

    fun cleanup() {
        resetLayout()
        detachManager()
    }

    private var imeAnimationActive = false
    private var stableHeight: Float? = null

    private fun setupKeyboardListener() {
        if (listenersInstalled) return
        listenersInstalled = true

        val density = resources.displayMetrics.density

        // Use WindowInsetsAnimation for smooth keyboard tracking (API 30+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ViewCompat.setWindowInsetsAnimationCallback(
                this,
                object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    override fun onPrepare(animation: WindowInsetsAnimationCompat) {
                        super.onPrepare(animation)
                        if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
                            imeAnimationActive = true
                        }
                    }

                    override fun onStart(
                        animation: WindowInsetsAnimationCompat,
                        bounds: WindowInsetsAnimationCompat.BoundsCompat
                    ): WindowInsetsAnimationCompat.BoundsCompat {
                        if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
                            // Capture the stable height before animation affects the view size.
                            val density = resources.displayMetrics.density
                            var baseHeight = this@ZynthKeyboardAvoidingView.height.toFloat()

                            val rootInsets = ViewCompat.getRootWindowInsets(this@ZynthKeyboardAvoidingView)
                            val imeInsets = rootInsets?.getInsets(WindowInsetsCompat.Type.ime())
                            val imeHeight = if (imeInsets == null) 0f else imeInsets.bottom / density
                            val isVisible = rootInsets?.isVisible(WindowInsetsCompat.Type.ime()) == true

                            // If we are currently in 'height' behavior and the keyboard is visibly open,
                            // restore full height to use as a stable base for closing animation.
                            if (behavior == KeyboardAvoidingBehavior.HEIGHT && isVisible && imeHeight > 0f) {
                                val overlapDp = imeHeight + keyboardVerticalOffset
                                baseHeight += (overlapDp * density)
                            }

                            stableHeight = baseHeight
                        }
                        return super.onStart(animation, bounds)
                    }

                    override fun onProgress(
                        insets: WindowInsetsCompat,
                        runningAnimations: MutableList<WindowInsetsAnimationCompat>
                    ): WindowInsetsCompat {
                        if (!isKeyboardEnabled) return insets

                        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                        val imeHeight = imeInsets.bottom / density
                        
                        // Only apply during progress if the IME animation is active
                        if (runningAnimations.any { it.typeMask and WindowInsetsCompat.Type.ime() != 0 }) {
                            applyAdjustment(imeHeight + keyboardVerticalOffset)
                        }

                        return insets
                    }

                    override fun onEnd(animation: WindowInsetsAnimationCompat) {
                        super.onEnd(animation)
                        
                        if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
                            imeAnimationActive = false
                            stableHeight = null
                        }

                        if (!isKeyboardEnabled) return

                        val insets = ViewCompat.getRootWindowInsets(this@ZynthKeyboardAvoidingView) ?: return
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

            // On Android R+, use this listener as a reconciliation path for transitions
            // that do not emit IME animations (e.g. back-dismiss on some OEMs, app resume).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && imeAnimationActive) {
                return@setOnApplyWindowInsetsListener insets
            }

            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            val imeHeight = imeInsets.bottom / density
            val isVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

            currentKeyboardHeight = if (isVisible) imeHeight else 0f
            applyAdjustment(if (isVisible) currentKeyboardHeight + keyboardVerticalOffset else 0f)

            insets
        }
    }

    private fun syncWithCurrentInsets() {
        if (!isAttached || !isKeyboardEnabled) return
        val density = resources.displayMetrics.density
        val insets = ViewCompat.getRootWindowInsets(this) ?: return
        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
        val imeHeight = imeInsets.bottom / density
        val isVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
        currentKeyboardHeight = if (isVisible) imeHeight else 0f
        applyAdjustment(if (isVisible) currentKeyboardHeight + keyboardVerticalOffset else 0f)
    }

    private fun clearAllBehaviorAdjustments() {
        translationY = 0f
        if (layoutManager != null && nodeId >= 0) {
            layoutManager?.applyKeyboardAvoidingAdjustment(nodeId, "padding", 0f)
            layoutManager?.applyKeyboardAvoidingAdjustment(nodeId, "height", 0f)
        } else {
            setPadding(paddingLeft, paddingTop, paddingRight, 0)
        }
    }

    private fun applyAdjustment(overlap: Float) {
        val overlapPx = overlap * resources.displayMetrics.density
        val shouldSkip = lastAppliedBehavior == behavior && lastAppliedOverlapPx == overlapPx
        if (shouldSkip) return
        lastAppliedBehavior = behavior
        lastAppliedOverlapPx = overlapPx
        
        when (behavior) {
            KeyboardAvoidingBehavior.PADDING -> {
                if (layoutManager != null && nodeId >= 0) {
                    layoutManager?.applyKeyboardAvoidingAdjustment(nodeId, "padding", overlapPx, stableHeight)
                } else {
                    setPadding(paddingLeft, paddingTop, paddingRight, overlapPx.toInt())
                }
            }
            KeyboardAvoidingBehavior.POSITION -> {
                translationY = -overlapPx
            }
            KeyboardAvoidingBehavior.HEIGHT -> {
                if (layoutManager != null && nodeId >= 0) {
                    layoutManager?.applyKeyboardAvoidingAdjustment(nodeId, "height", overlapPx, stableHeight)
                } else {
                    setPadding(paddingLeft, paddingTop, paddingRight, overlapPx.toInt())
                }
            }
        }
    }

    private fun resetLayout() {
        clearAllBehaviorAdjustments()
        currentKeyboardHeight = 0f
        lastAppliedOverlapPx = Float.NaN
        lastAppliedBehavior = null
    }
}
