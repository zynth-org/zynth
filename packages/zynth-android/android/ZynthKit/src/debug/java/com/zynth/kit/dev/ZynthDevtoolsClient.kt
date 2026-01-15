package com.zynth.kit.dev

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.ArrayDeque
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

private const val TAG = "ZynthDevtoolsClient"

class ZynthDevtoolsClient : WebSocketListener() {
  private val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.SECONDS)
    .pingInterval(15, TimeUnit.SECONDS)
    .build()

  private val reconnectHandler = Handler(Looper.getMainLooper())
  private var reconnectAttempts = 0
  private var stopped = false
  private var wsUrl: String? = null
  private var socket: WebSocket? = null
  private val queue = ArrayDeque<String>()
  private val maxQueue = 256

  val isConnected: Boolean
    get() = socket != null

  fun connect(url: String, token: String? = null) {
    val normalized = buildWsUrl(url, token) ?: run {
      Log.w(TAG, "Invalid devtools URL: $url")
      return
    }
    wsUrl = normalized
    stopped = false
    reconnectAttempts = 0
    openSocket()
  }

  fun disconnect() {
    stopped = true
    reconnectHandler.removeCallbacksAndMessages(null)
    socket?.close(1000, "client disconnect")
    socket = null
  }

  fun publish(payload: String) {
    synchronized(queue) {
      if (queue.size >= maxQueue) {
        queue.removeFirst()
      }
      queue.addLast(payload)
    }
    flushIfPossible()
  }

  override fun onOpen(webSocket: WebSocket, response: Response) {
    reconnectAttempts = 0
    socket = webSocket
    flushIfPossible()
  }

  override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
    socket = null
    if (!stopped) {
      scheduleReconnect()
    }
  }

  override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
    socket = null
    if (!stopped) {
      Log.w(TAG, "Devtools socket failure: ${t.message}")
      scheduleReconnect()
    }
  }

  private fun openSocket() {
    val url = wsUrl ?: return
    val request = Request.Builder().url(url).build()
    socket = client.newWebSocket(request, this)
  }

  private fun flushIfPossible() {
    val socket = socket ?: return
    val pending = mutableListOf<String>()
    synchronized(queue) {
      while (queue.isNotEmpty()) {
        pending.add(queue.removeFirst())
      }
    }
    for (message in pending) {
      socket.send(message)
    }
  }

  private fun scheduleReconnect() {
    if (stopped) return
    reconnectHandler.removeCallbacksAndMessages(null)
    val attempt = minOf(reconnectAttempts, 6)
    val delay = (Math.pow(2.0, attempt.toDouble()) * 500L).toLong().coerceAtMost(10_000L)
    reconnectAttempts = attempt + 1
    reconnectHandler.postDelayed({ openSocket() }, delay)
  }

  private fun buildWsUrl(url: String, token: String?): String? {
    val trimmed = url.trim()
    val base = when {
      trimmed.startsWith("ws://") || trimmed.startsWith("wss://") -> trimmed
      trimmed.startsWith("http://") -> "ws://" + trimmed.removePrefix("http://")
      trimmed.startsWith("https://") -> "wss://" + trimmed.removePrefix("https://")
      else -> return null
    }
    if (token.isNullOrBlank()) return base
    val separator = if (base.contains("?")) "&" else "?"
    return base + separator + "token=" + token
  }
}
