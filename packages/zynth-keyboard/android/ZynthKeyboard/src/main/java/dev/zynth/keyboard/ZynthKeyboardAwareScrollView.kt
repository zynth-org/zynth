package dev.zynth.keyboard

import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.view.MotionEvent
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ScrollView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat

/**
 * A scroll view that automatically adjusts for keyboard appearance
 * and scrolls to keep focused inputs visible.
 */
class ZynthKeyboardAwareScrollView(context: Context) : FrameLayout(context) {

    private val scrollView: KeyboardScrollView = KeyboardScrollView(context).apply {
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        isFillViewport = true
        isVerticalScrollBarEnabled = true
        isHorizontalScrollBarEnabled = false
        overScrollMode = OVER_SCROLL_ALWAYS
        clipChildren = false
        clipToPadding = false
    }

    private val contentView: FrameLayout = FrameLayout(context).apply {
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
        clipChildren = false
        clipToPadding = false
    }

    private val density: Float = resources.displayMetrics.density

    // Keyboard tracking
    private var keyboardEnabled: Boolean = true
    private var scrollToInputOnFocus: Boolean = true
    private var extraScrollHeight: Float = 75f
    private var keyboardVerticalOffset: Float = 0f
    private var currentKeyboardHeight: Float = 0f
    private var isKeyboardVisible: Boolean = false
    private var originalBottomPadding: Int = 0

    private val childLayoutListener = OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
        updateContentGeometry()
    }

    init {
        clipChildren = false
        clipToPadding = false

        scrollView.addView(contentView)
        super.addView(scrollView)

        setupKeyboardListener()
        setupFocusListener()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        post { syncKeyboardStateFromInsets() }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
    }

    // MARK: - View Management

    override fun addView(child: View?, index: Int, params: ViewGroup.LayoutParams?) {
        if (child == null) return
        if (child === scrollView) {
            super.addView(child, index, params)
            return
        }
        if (child.parent === contentView) return
        val safeIndex = index.coerceIn(0, contentView.childCount)
        contentView.addView(child, safeIndex, params)
        child.addOnLayoutChangeListener(childLayoutListener)
        post { updateContentGeometry() }
    }

    override fun removeView(view: View?) {
        if (view == null) return
        if (view === scrollView) {
            super.removeView(view)
            return
        }
        view.removeOnLayoutChangeListener(childLayoutListener)
        contentView.removeView(view)
        post { updateContentGeometry() }
    }

    override fun removeViewAt(index: Int) {
        if (index >= 0 && index < contentView.childCount) {
            val child = contentView.getChildAt(index)
            child?.removeOnLayoutChangeListener(childLayoutListener)
            contentView.removeViewAt(index)
            post { updateContentGeometry() }
        }
    }

    // MARK: - Configuration

    fun setScrollEnabled(enabled: Boolean) {
        scrollView.zynthScrollEnabled = enabled
    }

    fun setShowsVerticalScrollIndicator(show: Boolean) {
        scrollView.isVerticalScrollBarEnabled = show
    }

    fun setShowsHorizontalScrollIndicator(show: Boolean) {
        scrollView.isHorizontalScrollBarEnabled = show
    }

    fun setBounces(enabled: Boolean) {
        scrollView.overScrollMode = if (enabled) OVER_SCROLL_ALWAYS else OVER_SCROLL_NEVER
    }

    fun setContentInset(inset: Map<String, Any>?) {
        if (inset == null) {
            originalBottomPadding = 0
            updatePaddingForKeyboard()
            return
        }

        val top = ((inset["top"] as? Number)?.toFloat() ?: 0f) * density
        val left = ((inset["left"] as? Number)?.toFloat() ?: 0f) * density
        val bottom = ((inset["bottom"] as? Number)?.toFloat() ?: 0f) * density
        val right = ((inset["right"] as? Number)?.toFloat() ?: 0f) * density

        originalBottomPadding = bottom.toInt()
        scrollView.setPadding(left.toInt(), top.toInt(), right.toInt(), originalBottomPadding)
        updatePaddingForKeyboard()
    }

    fun setExtraScrollHeight(height: Float) {
        extraScrollHeight = height
    }

    fun setKeyboardVerticalOffset(offset: Float) {
        keyboardVerticalOffset = offset
        if (isKeyboardVisible) {
            updatePaddingForKeyboard()
        }
    }

    fun setKeyboardEnabled(enabled: Boolean) {
        keyboardEnabled = enabled
        if (!enabled) {
            resetPadding()
        }
    }

    fun setScrollToInputOnFocus(enabled: Boolean) {
        scrollToInputOnFocus = enabled
    }

    fun cleanup() {
        resetPadding()
    }

    fun insertContentSubview(child: View, index: Int) {
        if (child.parent === contentView) {
            contentView.removeView(child)
        } else {
            (child.parent as? ViewGroup)?.removeView(child)
        }
        val safeIndex = index.coerceIn(0, contentView.childCount)
        contentView.addView(child, safeIndex)
        child.addOnLayoutChangeListener(childLayoutListener)
        syncContentGeometry()
    }

    fun removeContentSubview(child: View) {
        child.removeOnLayoutChangeListener(childLayoutListener)
        if (child.parent === contentView) {
            contentView.removeView(child)
            syncContentGeometry()
        }
    }

    fun syncContentGeometry() {
        post { updateContentGeometry() }
    }

    // MARK: - Keyboard Observation

    private fun setupKeyboardListener() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ViewCompat.setWindowInsetsAnimationCallback(
                this,
                object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    override fun onProgress(
                        insets: WindowInsetsCompat,
                        runningAnimations: MutableList<WindowInsetsAnimationCompat>
                    ): WindowInsetsCompat {
                        if (!keyboardEnabled) return insets

                        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                        val imeHeight = imeInsets.bottom / density
                        val visible = insets.isVisible(WindowInsetsCompat.Type.ime())

                        currentKeyboardHeight = if (visible) imeHeight else 0f
                        isKeyboardVisible = visible
                        updatePaddingForKeyboard()

                        return insets
                    }

                    override fun onEnd(animation: WindowInsetsAnimationCompat) {
                        super.onEnd(animation)
                        if (!keyboardEnabled) return

                        val insets = ViewCompat.getRootWindowInsets(this@ZynthKeyboardAwareScrollView) ?: return
                        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                        val imeHeight = imeInsets.bottom / density
                        val visible = insets.isVisible(WindowInsetsCompat.Type.ime())

                        currentKeyboardHeight = if (visible) imeHeight else 0f
                        isKeyboardVisible = visible
                        updatePaddingForKeyboard()

                        // Scroll to focused input after keyboard animation completes
                        if (visible && scrollToInputOnFocus) {
                            scrollToFocusedInput()
                        }
                    }
                }
            )
        }

        // Fallback for older APIs using OnApplyWindowInsetsListener
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            if (!keyboardEnabled) return@setOnApplyWindowInsetsListener insets

            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            val imeHeight = imeInsets.bottom / density
            val visible = insets.isVisible(WindowInsetsCompat.Type.ime())

            if (visible != isKeyboardVisible || imeHeight != currentKeyboardHeight) {
                currentKeyboardHeight = if (visible) imeHeight else 0f
                isKeyboardVisible = visible
                updatePaddingForKeyboard()

                if (visible && scrollToInputOnFocus) {
                    post { scrollToFocusedInput() }
                }
            }

            insets
        }

        // Also use global layout listener as fallback
        viewTreeObserver.addOnGlobalLayoutListener {
            if (!keyboardEnabled) return@addOnGlobalLayoutListener

            val rect = Rect()
            getWindowVisibleDisplayFrame(rect)

            val screenHeight = rootView.height
            val keypadHeight = screenHeight - rect.bottom

            // Keyboard is visible if it takes up more than 15% of screen
            val visible = keypadHeight > screenHeight * 0.15
            val heightDp = keypadHeight / density

            if (visible != isKeyboardVisible || heightDp != currentKeyboardHeight) {
                currentKeyboardHeight = if (visible) heightDp else 0f
                isKeyboardVisible = visible
                updatePaddingForKeyboard()

                if (visible && scrollToInputOnFocus) {
                    post { scrollToFocusedInput() }
                }
            }
        }
    }

    private fun setupFocusListener() {
        // Listen for focus changes on descendant views
        viewTreeObserver.addOnGlobalFocusChangeListener { _, newFocus ->
            if (!keyboardEnabled || !scrollToInputOnFocus) return@addOnGlobalFocusChangeListener
            if (!isKeyboardVisible) return@addOnGlobalFocusChangeListener
            if (newFocus !is EditText) return@addOnGlobalFocusChangeListener

            // Check if the focused view is a descendant of our content view
            if (!isDescendantOf(newFocus, contentView)) return@addOnGlobalFocusChangeListener

            // Delay scroll to let keyboard settle
            postDelayed({ scrollToFocusedInput() }, 100)
        }
    }

    private fun isDescendantOf(view: View, parent: ViewGroup): Boolean {
        var current: View? = view
        while (current != null) {
            if (current === parent) return true
            val p = current.parent
            current = if (p is View) p else null
        }
        return false
    }

    // MARK: - Padding Management

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)

        // Yoga can place this host via direct layout() without a full Android measure pass.
        // Ensure the internal scroll viewport always matches host bounds.
        val width = right - left
        val height = bottom - top
        if (width > 0 && height > 0) {
            val widthSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
            val heightSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
            scrollView.measure(widthSpec, heightSpec)
            scrollView.layout(0, 0, width, height)
        }

        updateContentGeometry()
        syncKeyboardStateFromInsets()
    }

    private fun syncKeyboardStateFromInsets() {
        val insets = ViewCompat.getRootWindowInsets(this) ?: return
        val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
        val imeHeight = imeInsets.bottom / density
        val visible = insets.isVisible(WindowInsetsCompat.Type.ime())

        if (visible == isKeyboardVisible && imeHeight == currentKeyboardHeight) return

        currentKeyboardHeight = if (visible) imeHeight else 0f
        isKeyboardVisible = visible
        updatePaddingForKeyboard()
    }

    private fun updateContentGeometry() {
        val viewportWidth = if (scrollView.width > 0) scrollView.width else width
        val viewportHeight = if (scrollView.height > 0) scrollView.height else height
        if (viewportWidth <= 0 || viewportHeight <= 0) return

        var contentWidth = viewportWidth
        var contentHeight = viewportHeight

        if (contentView.childCount > 0) {
            val rect = Rect()

            fun isDescendantOfContent(view: View): Boolean {
                var current: View? = view
                while (current != null) {
                    if (current === contentView) return true
                    val parent = current.parent
                    current = if (parent is View) parent else null
                }
                return false
            }

            fun accumulate(view: View) {
                if (!isDescendantOfContent(view)) return
                rect.set(0, 0, view.width, view.height)
                try {
                    contentView.offsetDescendantRectToMyCoords(view, rect)
                } catch (_: IllegalArgumentException) {
                    // Child can be reparented while an update is queued.
                    return
                }
                contentWidth = maxOf(contentWidth, rect.right)
                contentHeight = maxOf(contentHeight, rect.bottom)

                if (view is ViewGroup) {
                    for (i in 0 until view.childCount) {
                        accumulate(view.getChildAt(i))
                    }
                }
            }

            for (i in 0 until contentView.childCount) {
                accumulate(contentView.getChildAt(i))
            }
        }

        val widthPx = contentWidth.coerceAtLeast(viewportWidth)
        val heightPx = contentHeight.coerceAtLeast(viewportHeight)
        val params = (contentView.layoutParams as? LayoutParams)
            ?: LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
        if (params.width != widthPx || params.height != heightPx) {
            params.width = widthPx
            params.height = heightPx
            contentView.layoutParams = params
        }

        if (contentView.width != widthPx || contentView.height != heightPx) {
            val widthSpec = MeasureSpec.makeMeasureSpec(widthPx, MeasureSpec.EXACTLY)
            val heightSpec = MeasureSpec.makeMeasureSpec(heightPx, MeasureSpec.EXACTLY)
            contentView.measure(widthSpec, heightSpec)
            contentView.layout(0, 0, widthPx, heightPx)
        }
    }

    private fun updatePaddingForKeyboard() {
        val keyboardHeight = currentKeyboardHeight + keyboardVerticalOffset
        val hasKeyboard = isKeyboardVisible && keyboardHeight > 0f
        val extraPadding = if (hasKeyboard) (extraScrollHeight * density).toInt() else 0

        // Calculate keyboard overlap with scroll view
        val location = IntArray(2)
        getLocationOnScreen(location)
        val scrollViewBottom = location[1] + height

        val screenHeight = resources.displayMetrics.heightPixels
        val keyboardTop = screenHeight - (keyboardHeight * density).toInt()

        var overlap = scrollViewBottom - keyboardTop
        if (overlap < 0) overlap = 0
        if (!hasKeyboard) overlap = 0

        val newBottomPadding = originalBottomPadding + overlap + extraPadding
        if (scrollView.paddingBottom != newBottomPadding) {
            scrollView.setPadding(
                scrollView.paddingLeft,
                scrollView.paddingTop,
                scrollView.paddingRight,
                newBottomPadding
            )
            // Force clamping of scroll position to the new padding/content bounds.
            // ScrollView.scrollTo will automatically clamp the current scrollY to the valid range.
            scrollView.scrollTo(scrollView.scrollX, scrollView.scrollY)
        }
    }

    private fun resetPadding() {
        scrollView.setPadding(
            scrollView.paddingLeft,
            scrollView.paddingTop,
            scrollView.paddingRight,
            originalBottomPadding
        )
        scrollView.scrollTo(scrollView.scrollX, scrollView.scrollY)
    }

    // MARK: - Scroll to Input

    private fun scrollToFocusedInput() {
        val focused = findFocus() ?: return
        if (focused !is EditText) return

        // Get the input's location relative to the scroll view content
        val inputLocation = IntArray(2)
        focused.getLocationInWindow(inputLocation)

        val scrollViewLocation = IntArray(2)
        scrollView.getLocationInWindow(scrollViewLocation)

        // Calculate relative Y position
        val relativeY = inputLocation[1] - scrollViewLocation[1] + scrollView.scrollY

        // Calculate visible area (accounting for keyboard)
        val visibleHeight = scrollView.height - scrollView.paddingBottom

        // Calculate desired scroll offset to center the input in visible area
        val inputCenterY = relativeY + focused.height / 2
        val desiredScrollY = inputCenterY - (visibleHeight / 2)

        // Clamp to valid range
        val maxScrollY = contentView.height - scrollView.height + scrollView.paddingBottom
        val clampedScrollY = desiredScrollY.coerceIn(0, maxScrollY)

        scrollView.smoothScrollTo(0, clampedScrollY)
    }

    private class KeyboardScrollView(context: Context) : ScrollView(context) {
        var zynthScrollEnabled: Boolean = true

        override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
            if (!zynthScrollEnabled) return false
            return super.onInterceptTouchEvent(ev)
        }

        override fun onTouchEvent(ev: MotionEvent): Boolean {
            if (!zynthScrollEnabled) return false
            return super.onTouchEvent(ev)
        }
    }
}
