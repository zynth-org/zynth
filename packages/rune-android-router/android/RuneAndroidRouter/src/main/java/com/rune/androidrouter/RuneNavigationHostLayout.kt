package com.rune.androidrouter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.FragmentContainerView

internal class RuneNavigationHostLayout(context: Context) : FrameLayout(context) {

    val fragmentContainerView: FragmentContainerView = FragmentContainerView(context)
    private val topSlot = FrameLayout(context)
    private val bottomSlot = FrameLayout(context)
    private var snapshotDrawable: BitmapDrawable? = null

    private var topHeight = 0
    private var bottomHeight = 0
    private var navBarInset = 0

    private var topListener: View.OnLayoutChangeListener? = null
    private var bottomListener: View.OnLayoutChangeListener? = null
    private var currentTopView: View? = null
    private var currentBottomView: View? = null
    private var bottomInsetListener: ((Int) -> Unit)? = null

    init {
        clipToPadding = false
        fragmentContainerView.layoutParams = LayoutParams(
            LayoutParams.MATCH_PARENT,
            LayoutParams.MATCH_PARENT,
        )
        addView(fragmentContainerView)

        topSlot.layoutParams = LayoutParams(
            LayoutParams.MATCH_PARENT,
            LayoutParams.WRAP_CONTENT,
            Gravity.TOP,
        )
        addView(topSlot)

        bottomSlot.layoutParams = LayoutParams(
            LayoutParams.MATCH_PARENT,
            LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM,
        )
        addView(bottomSlot)

        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            val systemBarInset = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
            if (navBarInset != systemBarInset) {
                navBarInset = systemBarInset
                updateFragmentInsets()
            }
            insets
        }
        ViewCompat.requestApplyInsets(this)
    }

    fun setBottomInsetListener(listener: ((Int) -> Unit)?) {
        bottomInsetListener = listener
        listener?.invoke(navBarInset)
    }

    fun setTopSlotView(view: View?) {
        topSlot.removeAllViews()
        topListener?.let { currentTopView?.removeOnLayoutChangeListener(it) }
        topListener = null
        currentTopView = view
        topHeight = 0
        if (view != null) {
            topSlot.addView(view)
            val listener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
                val height = view.height
                if (topHeight != height) {
                    topHeight = height
                    updateFragmentInsets()
                }
            }
            topListener = listener
            view.addOnLayoutChangeListener(listener)
        }
        updateFragmentInsets()
    }

    fun setBottomSlotView(view: View?) {
        bottomSlot.removeAllViews()
        bottomListener?.let { currentBottomView?.removeOnLayoutChangeListener(it) }
        bottomListener = null
        currentBottomView = view
        bottomHeight = 0
        if (view != null) {
            bottomSlot.addView(view)
            val listener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
                val height = view.height
                if (bottomHeight != height) {
                    bottomHeight = height
                    updateFragmentInsets()
                }
            }
            bottomListener = listener
            view.addOnLayoutChangeListener(listener)
        }
        updateFragmentInsets()
    }

    private fun updateFragmentInsets() {
        val hasBottomView = currentBottomView != null
        val contentBottomPadding = if (hasBottomView) bottomHeight else 0
        fragmentContainerView.setPadding(0, topHeight, 0, contentBottomPadding)
        bottomInsetListener?.invoke(if (hasBottomView) navBarInset else 0)
    }

    fun showContentSnapshot(): Boolean {
        clearSnapshot()
        val width = fragmentContainerView.width
        val height = fragmentContainerView.height
        if (width <= 0 || height <= 0) {
            return false
        }
        val bitmap = try {
            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        } catch (error: OutOfMemoryError) {
            return false
        }
        val canvas = Canvas(bitmap)
        fragmentContainerView.draw(canvas)
        val drawable = BitmapDrawable(context.resources, bitmap)
        snapshotDrawable = drawable
        fragmentContainerView.overlay.add(drawable)
        return true
    }

    fun hideContentSnapshot() {
        clearSnapshot()
    }

    private fun clearSnapshot() {
        snapshotDrawable?.let { drawable ->
            fragmentContainerView.overlay.remove(drawable)
            drawable.bitmap?.recycle()
        }
        snapshotDrawable = null
    }
}
