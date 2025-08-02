package com.rune.hypervisor

import android.content.Context
import android.widget.FrameLayout
import com.rune.kit.core.RuneRootView
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject
import java.io.File

class RuneHypervisorView(context: Context) : FrameLayout(context) {
    private var guestRuntime: RuneRuntime? = null
    private var guestRootView: RuneRootView? = null
    private var currentSource: JSONObject? = null

    // Callbacks to JS
    var onLoad: (() -> Unit)? = null
    var onError: ((message: String) -> Unit)? = null
    var onMessage: ((message: JSONObject) -> Unit)? = null // For Phase 4

    init {
        val root = RuneRootView(context)
        addView(root, LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        guestRootView = root
    }

    fun setSource(source: JSONObject?) {
        // Only reload if source actually changed
        if (source == null || source.toString() == currentSource?.toString()) {
            return
        }
        currentSource = source
        loadGuest(source)
    }

    fun reload() {
        currentSource?.let { loadGuest(it) }
    }

    fun destroy() {
        android.util.Log.d("RuneHypervisor", "Destroying RuneRuntime for Hypervisor View")
        guestRuntime?.destroy()
        guestRuntime = null
    }

    private fun loadGuest(source: JSONObject) {
        val root = guestRootView ?: run {
            onError?.invoke("Guest root view not available")
            return
        }
        
        // Clean up previous runtime
        destroy()

        val runtime = RuneRuntime(root)
        runtime.installDefaultModules()
        guestRuntime = runtime

        val uri = source.optString("uri")
        val code = source.optString("code")

        if (uri.isNotEmpty()) {
            try {
                // Assuming "uri" might point to an asset for now or a local file
                val assetManager = context.assets
                val jsCode = assetManager.open(uri).use { it.bufferedReader().readText() }
                runtime.load(jsCode)
                runtime.start(runtime.getRootSurfaceId())
                onLoad?.invoke()
            } catch (e: Exception) {
                android.util.Log.e("RuneHypervisor", "Failed to load bundle from asset URI: $uri", e)
                onError?.invoke("Failed to load bundle from asset: ${e.localizedMessage}")
            }
        } else if (code.isNotEmpty()) {
            try {
                runtime.load(code)
                runtime.start(runtime.getRootSurfaceId())
                onLoad?.invoke()
            } catch (e: Exception) {
                android.util.Log.e("RuneHypervisor", "Failed to evaluate inline code: ${e.localizedMessage}", e)
                onError?.invoke("Failed to evaluate inline code: ${e.localizedMessage}")
            }
        } else {
            onError?.invoke("Invalid source provided (neither uri nor code)")
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        destroy()
    }
}
