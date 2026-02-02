package com.zynth.hypervisor

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import com.zynth.kit.core.ZynthLayoutView
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.runtime.ZynthRuntime
import dev.zynth.apis.ZynthAPIs
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException

class ZynthHypervisorView(context: Context) : ZynthLayoutView(context) {
    private var guestRuntime: ZynthRuntime? = null
    private var guestRootView: ZynthRootView? = null
    private var currentSource: JSONObject? = null
    private var manager: ZynthUIManager? = null
    private var nodeId: Int? = null
    private var destroyed: Boolean = false
    private val registeredHandlers = mutableSetOf<String>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .retryOnConnectionFailure(true)
            .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
            .callTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .build()
    }

    // Callbacks to JS
    var onLoad: (() -> Unit)? = null
    var onError: ((message: String) -> Unit)? = null
    var onMessage: ((message: JSONObject) -> Unit)? = null // For Phase 4
    private val hypervisorPrelude = """
        globalThis.__ZYNTH_HYPERVISOR_BRIDGE__ = {
          postMessage: (message) => {
            globalThis.__modules.call('ZynthHypervisor', 'postMessage', [JSON.parse(message)]);
          }
        };
    """.trimIndent()
    private var lastLayoutWidth = 0
    private var lastLayoutHeight = 0

    init {
        ensureGuestRootView()
    }

    fun setSource(source: JSONObject?) {
        // Only reload if source actually changed
        if (source == null) return
        val signature = source.toString()
        if (signature == currentSource?.toString() && destroyed) {
            // After destroy, do not auto-reload the same source until an explicit reload
            return
        }
        if (signature == currentSource?.toString() && !destroyed) {
            return
        }
        destroyed = false
        currentSource = source
        loadGuest(source)
    }

    fun reload() {
        destroyed = false
        currentSource?.let { loadGuest(it) }
    }

    fun destroy(clearSource: Boolean = false, removeRoot: Boolean = true) {
        android.util.Log.d("ZynthHypervisor", "Destroying ZynthRuntime for Hypervisor View")
        destroyed = true
        val preservedSource = currentSource
        guestRuntime?.destroy()
        guestRuntime = null
        if (removeRoot) {
            guestRootView?.let { removeView(it) }
            guestRootView = null
            lastLayoutWidth = 0
            lastLayoutHeight = 0
        }
        currentSource = if (clearSource) null else preservedSource
    }

    fun bindNode(manager: ZynthUIManager, nodeId: Int) {
        this.manager = manager
        this.nodeId = nodeId
    }

    fun enableOnLoadHandler() {
        registeredHandlers.add("onLoad")
    }

    fun enableOnErrorHandler() {
        registeredHandlers.add("onError")
    }

    fun enableOnMessageHandler() {
        registeredHandlers.add("onMessage")
    }

    fun postMessage(message: Any?) {
        guestRuntime?.emitEvent("ZynthHypervisor:Message", message)
    }

    private fun loadGuest(source: JSONObject) {
        destroyed = false
        currentSource = source
        // Clean up previous runtime but keep the root view attached for seamless reload
        destroy(clearSource = false, removeRoot = false)

        val root = ensureGuestRootView()

        // Clean up previous runtime
        val runtime = ZynthRuntime(root)
        
        // Install Hypervisor Module
        val hypervisorModule = ZynthHypervisorModule(runtime) { message ->
            // Guest -> Host
            val jsonMsg = if (message is JSONObject) message else {
                JSONObject().put("data", message)
            }
            onMessage?.invoke(jsonMsg)
            emitEvent("onMessage", jsonMsg)
        }
        runtime.installModules(listOf(hypervisorModule))
        ZynthAPIs.initialize(context, runtime)
        
        guestRuntime = runtime
        syncRootToHostSize(force = true)

        val uri = source.optString("uri")
        val code = source.optString("code")
        val sourceSignature = source.toString()

        if (uri.isNotEmpty()) {
            if (uri.startsWith("http://") || uri.startsWith("https://")) {
                loadBundleFromNetwork(uri, runtime, sourceSignature)
            } else {
                loadBundleFromLocalUri(uri, runtime, sourceSignature)
            }
        } else if (code.isNotEmpty()) {
            startRuntimeWithCode(runtime, code, sourceSignature)
        } else {
            notifyError("Invalid source provided (neither uri nor code)")
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        destroy()
    }

    private fun loadBundleFromNetwork(uri: String, runtime: ZynthRuntime, sourceSignature: String) {
        Thread {
            try {
                val request = Request.Builder()
                    .url(uri)
                    .header("Cache-Control", "no-cache")
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IOException("Unexpected response ${response.code}")
                    }
                    val body = response.body?.string() ?: throw IOException("Empty bundle response")
                    startRuntimeWithCode(runtime, body, sourceSignature)
                }
            } catch (e: Exception) {
                android.util.Log.e("ZynthHypervisor", "Failed to load bundle from URL: $uri", e)
                mainHandler.post {
                    notifyError("Failed to load bundle from URL: ${e.localizedMessage}")
                }
            }
        }.start()
    }

    private fun loadBundleFromLocalUri(uri: String, runtime: ZynthRuntime, sourceSignature: String) {
        try {
            val jsCode = when {
                uri.startsWith("file://") -> File(uri.removePrefix("file://")).readText()
                uri.startsWith("/") -> File(uri).readText()
                else -> context.assets.open(uri).use { it.bufferedReader().readText() }
            }
            startRuntimeWithCode(runtime, jsCode, sourceSignature)
        } catch (e: Exception) {
            android.util.Log.e("ZynthHypervisor", "Failed to load bundle from local URI: $uri", e)
            notifyError("Failed to load bundle from local URI: ${e.localizedMessage}")
        }
    }

    private fun startRuntimeWithCode(runtime: ZynthRuntime, code: String, sourceSignature: String) {
        mainHandler.post {
            if (sourceSignature != currentSource?.toString()) return@post
            if (guestRuntime != runtime) return@post
            try {
                val combinedCode = "${hypervisorPrelude}\n$code"
                runtime.loadInitialBundle(context.assets, preloadedCode = combinedCode)
                runtime.start(runtime.rootSurfaceId)
                runtime.flush()
                notifyLoad()
            } catch (e: Exception) {
                android.util.Log.e("ZynthHypervisor", "Failed to evaluate code for hypervisor", e)
                notifyError("Failed to evaluate code: ${e.localizedMessage}")
            }
        }
    }

    private fun emitEvent(name: String, payload: JSONObject?) {
        val id = nodeId ?: return
        // Dispatch regardless of handler registration; UI manager will drop if not observed.
        manager?.dispatchEvent(id, name, payload)
    }

    private fun notifyError(message: String) {
        onError?.invoke(message)
        emitEvent("onError", JSONObject().put("message", message))
    }

    private fun notifyLoad() {
        onLoad?.invoke()
        emitEvent("onLoad", JSONObject())
    }

    private fun ensureGuestRootView(): ZynthRootView {
        var root = guestRootView
        if (root == null) {
            root = ZynthRootView(context)
            guestRootView = root
            addView(root, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            root.requestLayout()
            requestLayout()
            invalidate()
        }
        return root
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        val width = right - left
        val height = bottom - top
        if (width <= 0 || height <= 0) return
        val changedSize = width != lastLayoutWidth || height != lastLayoutHeight
        lastLayoutWidth = width
        lastLayoutHeight = height
        syncRootToHostSize(force = changedSize)
    }

    private fun syncRootToHostSize(force: Boolean) {
        val root = guestRootView ?: return
        val width = if (width > 0) width else lastLayoutWidth
        val height = if (height > 0) height else lastLayoutHeight
        if (width <= 0 || height <= 0) return
        if (force || root.measuredWidth != width || root.measuredHeight != height) {
            val wSpec = MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY)
            val hSpec = MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
            root.measure(wSpec, hSpec)
        }
        if (force || root.left != 0 || root.top != 0 || root.right != width || root.bottom != height) {
            root.layout(0, 0, width, height)
        }
        if (force) {
            guestRuntime?.flush()
        }
    }
}
