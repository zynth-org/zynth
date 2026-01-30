package com.zynth.kit.dev

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime
import java.util.concurrent.TimeUnit
import kotlin.math.min
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject

class ZynthDevClient(
  private val runtime: ZynthRuntime,
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
    synchronized(this) {
      val sameUrl = baseUrl?.toString() == url
      val sameToken = authToken == sanitizedToken
      if (isConnecting || (sameUrl && sameToken && socket != null)) {
        return
      }
      isConnecting = true
    }

    baseUrl = parsed
    authToken = sanitizedToken
    stopped = false
    reconnectAttempts = 0
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
    val wsUrl = buildWebSocketUrl(httpUrl, authToken) ?: return
    val request = Request.Builder()
      .url(wsUrl)
      .build()
    val existingSocket = socket
    socket = client.newWebSocket(request, this)
    existingSocket?.close(NORMAL_CLOSURE, "new connection")
  }

  private fun buildWebSocketUrl(httpUrl: HttpUrl, token: String?): String? {
    val scheme = if (httpUrl.isHttps) "wss" else "ws"
    val host = httpUrl.host
    if (host.isEmpty()) return null
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
    return url
  }

  override fun onOpen(webSocket: WebSocket, response: Response) {
    reconnectAttempts = 0
    isConnecting = false
    sendHello(webSocket)
  }

  override fun onMessage(webSocket: WebSocket, text: String) {
    handleMessage(text)
  }

  override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
    handleMessage(bytes.utf8())
  }

  override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
    isConnecting = false
    val selfInitiated = reason == "client disconnect" || reason == "new connection"
    if (!selfInitiated || code != NORMAL_CLOSURE) {
      scheduleReconnect()
    }
  }

  override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
    isConnecting = false
    if (!stopped) {
      scheduleReconnect()
    }
  }

  private fun sendHello(webSocket: WebSocket) {
    val payload =
      """{"type":"custom","event":"zynth:hello","data":{"platform":"android","timestamp":${System.currentTimeMillis()}}}"""
    webSocket.send(payload)
  }

  private fun scheduleReconnect() {
    if (stopped) return
    reconnectHandler.removeCallbacksAndMessages(null)
    val attempt = min(reconnectAttempts, 6)
    val delay = (Math.pow(2.0, attempt.toDouble()) * 500L).toLong().coerceAtMost(10_000L)
    reconnectAttempts = attempt + 1
    reconnectHandler.postDelayed({ openSocket() }, delay)
  }

  private fun handleMessage(text: String) {
    if (text == "__zynth_pong__") return
    val payload = try {
      JSONObject(text)
    } catch (_: Throwable) {
      runtime.handleDevMessage(text)
      return
    }

    when (val type = payload.optString("type")) {
      "hash", "ok", "still-ok", "built", "sync", "update", "warnings", "errors" -> {
        runtime.handleDevMessage(text)
      }
      else -> runtime.handleDevMessage(text)
    }
  }

  private fun sanitizeToken(token: String?): String? {
    val trimmed = token?.trim()
    return if (trimmed.isNullOrEmpty()) null else trimmed
  }

  companion object {
    private const val TAG = "ZynthDevClient"
    private const val NORMAL_CLOSURE = 1000
  }
}
