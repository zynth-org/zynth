package com.zynth.components.textinput

import android.content.Context
import android.view.View
import android.widget.FrameLayout

internal class ZynthTextInputContainer(context: Context) : FrameLayout(context) {
    private var inputView: ZynthTextInputView? = null

    fun setInputView(view: ZynthTextInputView) {
        if (inputView != null) {
            removeView(inputView)
        }
        inputView = view
        addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    fun getInputView(): ZynthTextInputView? = inputView

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // The container should size itself based on the input view
        inputView?.let {
            it.measure(widthMeasureSpec, heightMeasureSpec)
            setMeasuredDimension(it.measuredWidth, it.measuredHeight)
        } ?: super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        // The input view fills the container (respecting container padding if any)
        inputView?.layout(0, 0, right - left, bottom - top)
    }
}
