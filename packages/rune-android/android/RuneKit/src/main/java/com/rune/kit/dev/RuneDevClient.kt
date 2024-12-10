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
  @Volatile private var isConnecting = false

  fun connect(url: String) {
    val parsed = url.toHttpUrlOrNull()
    if (parsed == null) {
      Log.w(TAG, "Invalid dev server URL: $url")
      return
    }
    
    // Prevent duplicate connections
    synchronized(this) {
      if (isConnecting || (baseUrl?.toString() == url && socket != null)) {
        Log.d(TAG, "Already connecting/connected to $url")
        return
      }
      isConnecting = true
    }
    
    baseUrl = parsed
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
    val adjustedPath = ensureNativePath(httpUrl.encodedPath)
    val httpRequestUrl = httpUrl.newBuilder()
      .encodedPath(adjustedPath)
      .build()
    val httpString = httpRequestUrl.toString()
    val wsUrl = when (httpRequestUrl.scheme) {
      "https" -> "wss" + httpString.removePrefix("https")
      "http" -> "ws" + httpString.removePrefix("http")
      else -> {
        val port = httpRequestUrl.port.takeIf { it != -1 }
        buildString {
          append(if (httpUrl.isHttps) "wss" else "ws")
          append("://")
          append(httpRequestUrl.host)
          if (port != null) {
            append(":")
            append(port)
          }
          append(httpRequestUrl.encodedPath)
          if (httpRequestUrl.encodedQuery != null) {
            append("?")
            append(httpRequestUrl.encodedQuery)
          }
        }
      }
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
    isConnecting = false
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
    isConnecting = false
    // Don't reconnect if it was a normal closure from our side
    if (code != NORMAL_CLOSURE || reason != "client disconnect") {
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

  private fun processControlMessage(text: String): Boolean {
    return try {
      val payload = JSONObject(text)
      when (payload.optString("type")) {
        "update", "full-reload" -> {
          Log.d(TAG, "Received ${payload.optString("type")}, refreshing bundle")
          runtime.refreshDevBundle()
          true
        }
        "error" -> {
          Log.d(TAG, "Received HMR error payload $payload")
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
