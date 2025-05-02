package com.rune.androidrouter

import android.content.Context
import android.util.AttributeSet
import android.util.Log
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

    fun bindIcon(runeId: String?) {
        if (runeId == null) {
            clearIcon()
            return
        }
        renderIcon(runeId)
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

    private fun renderIcon(iconId: String) {
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
        val script = """
            (function(){
              const render = globalThis.__renderTabIcon;
              if (typeof render === 'function') {
                render($surface, $escapedId);
              }
            })();
        """.trimIndent()
        runtime.evaluateAsync(script)
    }
}
