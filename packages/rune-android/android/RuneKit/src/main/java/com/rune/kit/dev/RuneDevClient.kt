package com.rune.kit.dev

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.rune.kit.runtime.RuneRuntime
import java.util.concurrent.TimeUnit
import kotlin.math.min
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject

class RuneDevClient(
  private val runtime: RuneRuntime,
) : WebSocketListener() {
  private val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.SECONDS)
    .pingInterval(15, TimeUnit.SECONDS)
    .build()

  private val reconnectHandler = Handler(Looper.getMainLooper())
  private var reconnectAttempts = 0
  private var stopped = false
  private var baseUrl: HttpUrl? = null
  private var socket: WebSocket? = null
  @Volatile private var isConnecting = false
  @Volatile private var authToken: String? = null

  fun connect(url: String, token: String?) {
    val parsed = url.toHttpUrlOrNull()
    if (parsed == null) {
      Log.w(TAG, "Invalid dev server URL: $url")
      return
    }

    val sanitizedToken = sanitizeToken(token)
    Log.d(
      TAG,
      "connect called url=$url tokenPresent=${sanitizedToken != null} tokenPrefix=${sanitizedToken?.take(8)}"
    )

    // Prevent duplicate connections
    synchronized(this) {
      val sameUrl = baseUrl?.toString() == url
      val sameToken = authToken == sanitizedToken
      if (isConnecting || (sameUrl && sameToken && socket != null)) {
        Log.d(TAG, "Already connecting/connected to $url")
        return
      }
      isConnecting = true
    }

    baseUrl = parsed
    authToken = sanitizedToken
    stopped = false
    reconnectAttempts = 0
    Log.d(TAG, "Connecting to dev server $url")
    openSocket()
  }

  fun disconnect() {
    stopped = true
    isConnecting = false
    reconnectHandler.removeCallbacksAndMessages(null)
    socket?.close(NORMAL_CLOSURE, "client disconnect")
    socket = null
  }

  private fun openSocket() {
    val httpUrl = baseUrl ?: return
    Log.d(
      TAG,
      "openSocket base=$httpUrl tokenPresent=${authToken != null} tokenPrefix=${authToken?.take(8)}"
    )
    val wsUrl = buildWebSocketUrl(httpUrl, authToken)
    if (wsUrl == null) {
      Log.w(TAG, "Unable to derive WebSocket URL from ${httpUrl}")
      return
    }
    Log.d(TAG, "Opening WebSocket ${wsUrl}")
    val request = Request.Builder()
      .url(wsUrl)
      .build()

    // Close existing socket only if we have one
    val existingSocket = socket
    socket = client.newWebSocket(request, this)
    
    // Close the old socket after creating the new one to avoid race conditions
    existingSocket?.close(NORMAL_CLOSURE, "new connection")
  }

  private fun buildWebSocketUrl(httpUrl: HttpUrl, token: String?): String? {
    val scheme = if (httpUrl.isHttps) "wss" else "ws"
    val host = httpUrl.host
    if (host.isNullOrEmpty()) {
      return null
    }
    val port = httpUrl.port
    val url = buildString {
      append(scheme)
      append("://")
      append(host)
      if (port != -1 && port != 80 && port != 443) {
        append(":")
        append(port)
      }
      append("/rsbuild-hmr")
      val sanitized = sanitizeToken(token)
      if (sanitized != null) {
        append("?token=")
        append(Uri.encode(sanitized))
      }
    }
    Log.d(TAG, "buildWebSocketUrl result=$url tokenPresent=${token != null}")
    return url
  }

  override fun onOpen(webSocket: WebSocket, response: Response) {
    reconnectAttempts = 0
    isConnecting = false
    Log.d(TAG, "Connected to dev server ${webSocket.request().url}")
    sendHello(webSocket)
  }

  override fun onMessage(webSocket: WebSocket, text: String) {
    handleMessage(text)
  }

  override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
    val text = bytes.utf8()
    handleMessage(text)
  }

  override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
    Log.d(TAG, "Dev socket closed code=$code reason=$reason")
    isConnecting = false
    val selfInitiated = reason == "client disconnect" || reason == "new connection"
    // Don't reconnect if it was a normal closure from our side
    if (!selfInitiated || code != NORMAL_CLOSURE) {
      scheduleReconnect()
    }
  }

  override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
    isConnecting = false
    if (!stopped) {
      Log.w(TAG, "Dev socket failure: ${t.message}")
    }
    scheduleReconnect()
  }

  private fun sendHello(webSocket: WebSocket) {
    val payload = """{"type":"custom","event":"rune:hello","data":{"platform":"android","timestamp":${System.currentTimeMillis()}}}"""
    webSocket.send(payload)
  }

  private fun scheduleReconnect() {
    if (stopped) {
      return
    }
    reconnectHandler.removeCallbacksAndMessages(null)
    val attempt = min(reconnectAttempts, 6)
    val delay = (Math.pow(2.0, attempt.toDouble()) * 500L).toLong().coerceAtMost(10_000L)
    reconnectAttempts = attempt + 1
    reconnectHandler.postDelayed({ openSocket() }, delay)
  }

  private fun handleMessage(text: String) {
    if (text == "__rune_pong__") {
      return
    }
    val payload = try {
      JSONObject(text)
    } catch (t: Throwable) {
      runtime.handleDevMessage(text)
      return
    }

    when (val type = payload.optString("type")) {
      "hash" -> {
        Log.d(TAG, "New compilation hash ${payload.optString("data")}")
      }
      "ok", "still-ok", "built", "sync" -> {
        Log.d(TAG, "Compilation message received: $type")
      }
      "update" -> {
        Log.d(TAG, "Forwarding hot update payload to runtime")
      }
      "warnings" -> {
        Log.w(TAG, "Compilation warnings: $payload")
      }
      "errors" -> {
        Log.e(TAG, "Compilation errors: $payload")
      }
      else -> {
        if (type.isNotBlank()) {
          Log.d(TAG, "Unhandled dev message type '$type'")
        }
      }
    }

    runtime.handleDevMessage(text)
  }

  private fun sanitizeToken(token: String?): String? {
    val trimmed = token?.trim()
    return if (trimmed.isNullOrEmpty()) null else trimmed
  }

  companion object {
    private const val TAG = "RuneDevClient"
    private const val NORMAL_CLOSURE = 1000
  }
}
