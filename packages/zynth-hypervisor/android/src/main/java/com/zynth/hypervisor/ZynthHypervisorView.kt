package com.zynth.hypervisor

import android.content.Context
import android.widget.FrameLayout
import android.os.Handler
import android.os.Looper
import com.zynth.kit.core.ZynthRootView
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.runtime.ZynthRuntime
import dev.zynth.apis.ZynthAPIs
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException

class ZynthHypervisorView(context: Context) : FrameLayout(context) {
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
        val runtime = ZynthRuntime(root, enableDevServer = false)
        
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
        runtime.installDefaultModules()
        ZynthAPIs.initialize(context, runtime)
        
        // Inject JS bridge for guest to communicate with native module
        runtime.load("globalThis.__ZYNTH_HYPERVISOR_BRIDGE__ = {\n" +
                         "    postMessage: (message) => {\n" +
                         "      globalThis.__modules.call('ZynthHypervisor', 'postMessage', [JSON.parse(message)]);\n" +
                         "    }\n" +
                         "  };")
        
        guestRuntime = runtime

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
                runtime.load(code)
                runtime.start(runtime.getRootSurfaceId())
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
        }
        return root
    }
}
