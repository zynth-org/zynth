package com.rune.androidrouter

import android.content.Context
import android.util.AttributeSet
import android.util.Log
import android.util.TypedValue
import android.widget.FrameLayout
import com.rune.kit.core.RuneRootView
import org.json.JSONObject

private const val TAB_ICON_TAG = "RuneTabIconHostView"

class RuneTabIconHostView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {

    private val iconRoot = RuneRootView(context)
    private var surfaceId: Int? = null
    private var desiredWidthPx: Int = dpToPx(24)
    private var desiredHeightPx: Int = dpToPx(24)

    init {
        layoutParams = LayoutParams(
            LayoutParams.MATCH_PARENT,
            LayoutParams.MATCH_PARENT,
        )
        addView(
            iconRoot,
            LayoutParams(
                LayoutParams.MATCH_PARENT,
                LayoutParams.MATCH_PARENT,
            ),
        )
        registerSurfaceIfNeeded()
    }

    fun updateDesiredSize(widthPx: Int, heightPx: Int) {
        if (widthPx <= 0 || heightPx <= 0) {
            return
        }
        if (desiredWidthPx != widthPx || desiredHeightPx != heightPx) {
            desiredWidthPx = widthPx
            desiredHeightPx = heightPx
            requestLayout()
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val resolvedWidth = resolveSize(desiredWidthPx, widthMeasureSpec)
        val resolvedHeight = resolveSize(desiredHeightPx, heightMeasureSpec)
        val childWidthSpec = MeasureSpec.makeMeasureSpec(resolvedWidth, MeasureSpec.EXACTLY)
        val childHeightSpec = MeasureSpec.makeMeasureSpec(resolvedHeight, MeasureSpec.EXACTLY)
        for (index in 0 until childCount) {
            getChildAt(index).measure(childWidthSpec, childHeightSpec)
        }
        setMeasuredDimension(resolvedWidth, resolvedHeight)
    }

    fun bindIcon(runeId: String?, isActive: Boolean) {
        if (runeId == null) {
            clearIcon()
            return
        }
        renderIcon(runeId, isActive)
    }

    fun clearIcon() {
        val surface = surfaceId ?: return
        val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
        runtime.setActiveSurface(surface)
        val script = """
            (function(){
              const dispose = globalThis.__disposeTabIcon;
              if (typeof dispose === 'function') {
                dispose($surface);
              }
            })();
        """.trimIndent()
        runtime.evaluateAsync(script)
    }

    fun dispose() {
        clearIcon()
        surfaceId?.let { RuneAndroidRouterHost.runtimeOrNull()?.unregisterSurface(it) }
        surfaceId = null
    }

    private fun registerSurfaceIfNeeded() {
        if (surfaceId != null) return
        val runtime = RuneAndroidRouterHost.runtimeOrNull()
        if (runtime == null) {
            Log.w(TAB_ICON_TAG, "Runtime not available; icon will register later")
            return
        }
        runtime.registerSurface(iconRoot)
        surfaceId = iconRoot.rootId
    }

    private fun renderIcon(iconId: String, isActive: Boolean) {
        var surface = surfaceId
        if (surface == null) {
            registerSurfaceIfNeeded()
            surface = surfaceId
            if (surface == null) {
                Log.w(TAB_ICON_TAG, "Surface not ready; cannot render icon $iconId")
                return
            }
        }
        val runtime = RuneAndroidRouterHost.runtimeOrNull() ?: return
        runtime.setActiveSurface(surface)
        val escapedId = JSONObject.quote(iconId)
        val activeFlag = if (isActive) "true" else "false"
        val script = """
            (function(){
              const render = globalThis.__renderTabIcon;
              if (typeof render === 'function') {
                render($surface, $escapedId, $activeFlag);
              }
            })();
        """.trimIndent()
        runtime.evaluateAsync(script)
    }

    private fun dpToPx(dp: Int): Int {
        val metrics = context.resources.displayMetrics
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp.toFloat(), metrics).toInt()
    }
}
