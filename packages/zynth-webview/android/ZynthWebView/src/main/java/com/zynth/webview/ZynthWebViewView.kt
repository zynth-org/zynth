package com.zynth.webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Log
import android.view.ViewOutlineProvider
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.WindowInsets
import com.zynth.kit.core.ZynthUIManager
import org.json.JSONObject
import org.json.JSONTokener

@SuppressLint("SetJavaScriptEnabled")
class ZynthWebViewView(context: Context) : WebView(context) {
  private var manager: ZynthUIManager? = null
  private var nodeId: Int = -1
  private var source: JSONObject? = null
  private var lastCommandId = -1
  private var pendingNativeReady = false

  private var loading = false
  private var currentUrl = ""
  private var currentTitle = ""

  init {
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
      setWebContentsDebuggingEnabled(true)
    }

    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.useWideViewPort = true
    settings.loadWithOverviewMode = true
    settings.allowFileAccess = true
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
      settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    }
    setBackgroundColor(Color.TRANSPARENT)
    outlineProvider = ViewOutlineProvider.BOUNDS
    clipToOutline = true
    fitsSystemWindows = false
    setPadding(0, 0, 0, 0)
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
      setOnApplyWindowInsetsListener { _, insets -> insets }
    }

    addJavascriptInterface(JSBridge(), "ZynthWebViewBridge")

    webChromeClient = object : WebChromeClient() {
      override fun onReceivedTitle(view: WebView?, title: String?) {
        currentTitle = title ?: ""
      }

      override fun onProgressChanged(view: WebView?, newProgress: Int) {
        super.onProgressChanged(view, newProgress)
        Log.d("ZynthWebView", "onProgressChanged progress=$newProgress")
      }
    }

    webViewClient = object : WebViewClient() {
      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        loading = true
        currentUrl = url ?: currentUrl
        emit("onLoadStart", navigationPayload(loading = true))
        emit("onNavigationStateChange", navigationPayload(loading = true))
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        loading = false
        currentUrl = url ?: currentUrl
        injectMessagingBridge()
        val payload = navigationPayload(loading = false)
        emit("onLoad", payload)
        emit("onLoadEnd", payload)
        emit("onNavigationStateChange", payload)
      }

      override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
      ) {
        super.onReceivedError(view, request, error)
        if (request != null && !request.isForMainFrame) return

        loading = false
        val payload = navigationPayload(loading = false)
        payload.put("code", error?.errorCode ?: -1)
        payload.put("domain", "android.webview")
        payload.put("description", error?.description?.toString() ?: "Unknown error")

        emit("onError", payload)
        emit("onLoadEnd", payload)
        emit("onNavigationStateChange", navigationPayload(loading = false))
      }
    }
  }

  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    // Insets are handled by Zynth/Yoga containers (safe-area). Avoid WebView applying them internally.
    return insets
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    Log.d("ZynthWebView", "onSizeChanged w=$w h=$h visibility=$visibility")
  }

  fun bind(manager: ZynthUIManager, nodeId: Int) {
    this.manager = manager
    this.nodeId = nodeId
    if (pendingNativeReady) {
      pendingNativeReady = false
      notifyNativeReady()
    }
  }

  fun notifyNativeReady() {
    if (nodeId <= 0) {
      pendingNativeReady = true
      return
    }
    Log.d("ZynthWebView", "notifyNativeReady emitting event for nodeId=$nodeId")
    val payload = JSONObject()
    payload.put("available", true)
    emit("onNativeReady", payload)
  }

  fun setSourceFromRaw(raw: String?) {
    Log.d("ZynthWebView", "setSourceFromRaw raw=${preview(raw)}")
    val parsed = parseObject(raw)
    if (parsed == null) {
      Log.w("ZynthWebView", "setSourceFromRaw parse failed")
      return
    }
    val signature = parsed.toString()
    if (source?.toString() == signature) {
      Log.d("ZynthWebView", "setSourceFromRaw identical source ignored")
      return
    }
    source = parsed
    loadSourceObject(parsed)
  }

  private fun loadSourceObject(parsed: JSONObject) {
    val uri = parsed.optString("uri", "")
    if (uri.isNotEmpty()) {
      Log.d("ZynthWebView", "setSourceFromRaw loading uri=$uri")
      val headersMap = mutableMapOf<String, String>()
      val headers = parsed.optJSONObject("headers")
      if (headers != null) {
        headers.keys().forEach { key ->
          headersMap[key] = headers.optString(key)
        }
      }
      loadUrl(uri, headersMap)
      return
    }

    val html = parsed.optString("html", "")
    if (html.isNotEmpty()) {
      val baseUrl = parsed.optString("baseUrl", "").takeIf { it.isNotBlank() } ?: "http://localhost/"
      Log.d(
        "ZynthWebView",
        "setSourceFromRaw loading html length=${html.length} baseUrl=$baseUrl"
      )
      loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null)
      return
    }

    Log.w("ZynthWebView", "setSourceFromRaw ignored source without uri/html keys")
  }

  fun setJavaScriptEnabled(enabled: Boolean) {
    settings.javaScriptEnabled = enabled
  }

  fun setUserAgent(userAgent: String?) {
    settings.userAgentString = userAgent
  }

  fun executeCommandFromRaw(raw: String?) {
    val command = parseObject(raw) ?: return
    val id = command.optInt("id", -1)
    if (id <= lastCommandId) return
    lastCommandId = id

    when (command.optString("type", "")) {
      "reload" -> {
        val currentSource = source
        if (currentSource != null) {
          Log.d("ZynthWebView", "reload using cached source")
          loadSourceObject(currentSource)
        } else {
          Log.d("ZynthWebView", "reload fallback webView.reload()")
          reload()
        }
      }
      "goBack" -> if (canGoBack()) goBack()
      "goForward" -> if (canGoForward()) goForward()
      "stopLoading" -> stopLoading()
      "injectJavaScript" -> {
        val script = command.optString("payload", "")
        if (script.isNotEmpty()) {
          evaluateJavascript(script, null)
        }
      }
      "postMessage" -> {
        val payload = command.optString("payload", "")
        val quoted = JSONObject.quote(payload)
        val script = "(function(){var __d=$quoted;window.dispatchEvent(new MessageEvent('message',{data:__d}));document.dispatchEvent(new MessageEvent('message',{data:__d}));})();"
        evaluateJavascript(script, null)
      }
    }
  }

  fun reset() {
    source = null
    lastCommandId = -1
    stopLoading()
    loadUrl("about:blank")
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    onResume()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    onPause()
  }

  private fun emit(name: String, payload: JSONObject) {
    if (nodeId <= 0) {
      Log.w("ZynthWebView", "Cannot emit event '$name' because nodeId is $nodeId (not bound yet)")
      return
    }
    manager?.dispatchEvent(nodeId, name, payload)
  }

  private fun navigationPayload(loading: Boolean): JSONObject {
    val payload = JSONObject()
    payload.put("url", currentUrl)
    payload.put("title", currentTitle)
    payload.put("loading", loading)
    payload.put("canGoBack", canGoBack())
    payload.put("canGoForward", canGoForward())
    return payload
  }

  private fun injectMessagingBridge() {
    evaluateJavascript(messagingBridgeScript(), null)
  }

  private fun messagingBridgeScript(): String {
    return "(function(){if(window.ZynthWebView&&window.ZynthWebView.postMessage){return;}window.ZynthWebView={postMessage:function(data){ZynthWebViewBridge.postMessage(String(data));}};window.ReactNativeWebView=window.ZynthWebView;})();"
  }

  private fun parseObject(raw: String?): JSONObject? {
    if (raw == null) return null
    var trimmed = raw.trim()
    if (trimmed.isEmpty() || trimmed == "null") return null

    // Some bridge paths deliver stringified JSON payloads with surrounding quotes.
    if (trimmed.length >= 2 && trimmed.first() == '"' && trimmed.last() == '"') {
      trimmed = trimmed.substring(1, trimmed.length - 1).replace("\\\"", "\"")
    }

    return try {
      when (val parsed = JSONTokener(trimmed).nextValue()) {
        is JSONObject -> parsed
        is String -> {
          val nested = parsed.trim()
          if (nested.startsWith("{")) {
            JSONObject(nested)
          } else {
            null
          }
        }
        else -> null
      }
    } catch (error: Throwable) {
      Log.w("ZynthWebView", "Failed to parse JSON payload: $trimmed", error)
      null
    }
  }

  private fun preview(raw: String?): String {
    if (raw == null) return "(null)"
    val compact = raw.replace('\n', ' ')
    return if (compact.length > 220) compact.take(220) + "..." else compact
  }

  private inner class JSBridge {
    @JavascriptInterface
    fun postMessage(data: String) {
      val payload = JSONObject()
      payload.put("data", data)
      payload.put("url", currentUrl)
      emit("onMessage", payload)
    }
  }
}
