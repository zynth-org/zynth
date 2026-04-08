package com.zynth.kit.runtime.modules

import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

internal class WebSocketModule(private val runtime: ZynthRuntime) : ZynthModule {
  override val name: String = "WebSocket"
  override val exportedMethods: List<String> = listOf(
    "connect",
    "send",
    "close",
    "reloadDevBundle",
  )

  private val client = OkHttpClient.Builder()
    .retryOnConnectionFailure(true)
    .pingInterval(30, TimeUnit.SECONDS)
    .build()
  private val sockets = ConcurrentHashMap<Int, WebSocket>()

  override fun invalidate() {
    sockets.forEach { (_, socket) ->
      socket.close(1001, "runtime invalidated")
    }
    sockets.clear()
  }

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return when (method) {
      "connect" -> connect(args)
      "send" -> send(args)
      "close" -> close(args)
      "reloadDevBundle" -> reloadDevBundle(args)
      else -> JSONObject().put("error", "unknown_method").put("method", method)
    }
  }

  private fun connect(args: ZynthArgs): JSONObject {
    val id = args.getInt("id")
    val url = args.getString("url")
    val request = Request.Builder().url(url).build()
    client.newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        sockets[id] = webSocket
        emit(id, "open")
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        emit(id, "message", JSONObject().put("data", text))
      }

      override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        webSocket.close(code, reason)
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        sockets.remove(id)
        emit(id, "close", JSONObject()
          .put("code", code)
          .put("reason", reason)
          .put("wasClean", code == 1000)
        )
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        sockets.remove(id)
        emit(id, "error", JSONObject().put("message", t.message ?: "WebSocket error"))
        emit(id, "close", JSONObject()
          .put("code", 1006)
          .put("reason", t.message ?: "WebSocket failure")
          .put("wasClean", false)
        )
      }
    })
    return JSONObject().put("result", true)
  }

  private fun send(args: ZynthArgs): JSONObject {
    val id = args.getInt("id")
    val data = args.getString("data")
    val socket = sockets[id] ?: return JSONObject().put("error", "socket_not_found")
    val ok = socket.send(data)
    return JSONObject().put("result", ok)
  }

  private fun close(args: ZynthArgs): JSONObject {
    val id = args.getInt("id")
    val code = args.getInt("code", 1000)
    val reason = args.getString("reason", "")
    val socket = sockets.remove(id) ?: return JSONObject().put("result", true)
    socket.close(code, reason)
    return JSONObject().put("result", true)
  }

  private fun reloadDevBundle(args: ZynthArgs): JSONObject {
    val baseUrl = args.getOptionalString("url")
      ?: return JSONObject().put("error", "invalid_url")
    val token = args.getOptionalString("token")
    val rootId = args.getInt("rootId", runtime.rootSurfaceId)
    Thread({
      try {
        val base = baseUrl.toHttpUrlOrNull() ?: throw IllegalArgumentException("Invalid dev server URL")
        val builder = base.newBuilder().encodedPath("/main.js")
        if (!token.isNullOrBlank()) {
          builder.removeAllQueryParameters("token")
          builder.addQueryParameter("token", token)
        }
        val request = Request.Builder()
          .url(builder.build())
          .header("Cache-Control", "no-cache")
          .build()
        client.newCall(request).execute().use { response ->
          if (!response.isSuccessful) {
            throw IllegalStateException("Bundle reload failed with ${response.code}")
          }
          val code = response.body?.string() ?: throw IllegalStateException("Bundle reload returned empty body")
          runtime.evaluateScript(code, "main.js")
          runtime.evaluateScript("globalThis.__startApp && globalThis.__startApp($rootId);", "dev-bundle-restart.js")
        }
      } catch (t: Throwable) {
        emit(-1, "error", JSONObject().put("message", "Dev bundle reload failed: ${t.message}"))
      }
    }, "ZynthDevBundleReload").start()
    return JSONObject().put("result", true)
  }

  private fun emit(id: Int, type: String, payload: JSONObject = JSONObject()) {
    payload.put("id", id)
    payload.put("type", type)
    runtime.emitEvent("zynth.websocket.event", payload)
  }
}
