package com.rune.kit.dev

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

  fun connect(url: String) {
    val parsed = url.toHttpUrlOrNull()
    if (parsed == null) {
      Log.w(TAG, "Invalid dev server URL: $url")
      return
    }
    baseUrl = parsed
    stopped = false
    reconnectAttempts = 0
    openSocket()
  }

  fun disconnect() {
    stopped = true
    reconnectHandler.removeCallbacksAndMessages(null)
    socket?.close(NORMAL_CLOSURE, "client disconnect")
    socket = null
  }

  private fun openSocket() {
    val httpUrl = baseUrl ?: return
    val wsUrl = httpUrl.newBuilder()
      .scheme(if (httpUrl.isHttps) "wss" else "ws")
      .encodedPath(ensureNativePath(httpUrl.encodedPath))
      .build()
    val request = Request.Builder()
      .url(wsUrl)
      .build()

    socket?.close(NORMAL_CLOSURE, "reconnecting")
    socket = client.newWebSocket(request, this)
  }

  private fun ensureNativePath(path: String): String {
    if (path.isEmpty() || path == "/") {
      return "/rune-native"
    }
    var trimmed = path
    if (trimmed.endsWith('/')) {
      trimmed = trimmed.dropLast(1)
    }
    if (trimmed.endsWith("rune-native")) {
      return trimmed
    }
    return "$trimmed/rune-native"
  }

  override fun onOpen(webSocket: WebSocket, response: Response) {
    reconnectAttempts = 0
    Log.d(TAG, "Connected to dev server ${webSocket.request().url}")
    sendHello(webSocket)
  }

  override fun onMessage(webSocket: WebSocket, text: String) {
    if (text == "__rune_pong__") {
      return
    }
    if (processControlMessage(text)) {
      return
    }
    runtime.handleDevMessage(text)
  }

  override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
    val text = bytes.utf8()
    if (text == "__rune_pong__") {
      return
    }
    if (processControlMessage(text)) {
      return
    }
    runtime.handleDevMessage(text)
  }

  override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
    Log.d(TAG, "Dev socket closed code=$code reason=$reason")
    scheduleReconnect()
  }

  override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
    if (!stopped) {
      Log.w(TAG, "Dev socket failure", t)
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

  private fun processControlMessage(text: String): Boolean {
    return try {
      val payload = JSONObject(text)
      when (payload.optString("type")) {
        "update", "full-reload" -> {
          Log.d(TAG, "Received ${payload.optString("type")}, refreshing bundle")
          runtime.refreshDevBundle()
          true
        }
        else -> false
      }
    } catch (t: Throwable) {
      false
    }
  }

  companion object {
    private const val TAG = "RuneDevClient"
    private const val NORMAL_CLOSURE = 1000
  }
}
