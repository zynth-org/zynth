package com.zynth.kit.runtime.modules

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class FetchModule(private val runtime: ZynthRuntime) : ZynthModule {
    override val name: String = "Fetch"

    private val client = OkHttpClient.Builder().build()
    private val calls = java.util.concurrent.ConcurrentHashMap<Int, okhttp3.Call>()
    private val pendingChunks = java.util.concurrent.ConcurrentHashMap<Int, MutableList<ByteArray>>()
    private val pendingEnd = java.util.concurrent.ConcurrentHashMap<Int, Boolean>()
    private val pendingError = java.util.concurrent.ConcurrentHashMap<Int, String>()
    private val startedStreams = java.util.concurrent.ConcurrentHashMap<Int, Boolean>()

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "request" -> handleRequest(args.firstOrNull())
            "cancel" -> handleCancel(args.firstOrNull())
            "streamStart" -> handleStreamStart(args.firstOrNull())
            else -> errorResponse("unknown_method", method)
        }
    }

    private fun handleRequest(payload: Any?): JSONObject {
        val params = payload as? JSONObject ?: return errorResponse("invalid_arguments")
        if (!params.has("requestId")) return errorResponse("missing_request_id")
        val requestId = params.getInt("requestId")
        
        val url = params.optString("url")
        if (url.isBlank()) return errorResponse("invalid_url")

        val method = params.optString("method", "GET").uppercase()
        val headers = params.optJSONObject("headers")
        val timeoutSeconds = params.optDouble("timeout", 0.0)
        val wantsStream = params.optBoolean("stream", false)

        val builder = Request.Builder().url(url)
        if (headers != null) {
            val keys = headers.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = headers.optString(key)
                if (value.isNotEmpty()) {
                    builder.header(key, value)
                }
            }
        }

        if (params.has("body")) {
            val body = params.get("body")
            val mediaType = headers?.optString("Content-Type")?.toMediaTypeOrNull()
            val bytes = coerceBodyBytes(body)
            if (bytes != null) {
                builder.method(method, bytes.toRequestBody(mediaType))
            } else if (body is String) {
                val stringType = mediaType ?: "text/plain; charset=utf-8".toMediaTypeOrNull()
                builder.method(method, body.toRequestBody(stringType))
            } else {
                return errorResponse("unsupported_body", body::class.java.name)
            }
        } else {
            builder.method(method, if (method == "GET" || method == "HEAD") null else ByteArray(0).toRequestBody())
        }

        val callClient = if (timeoutSeconds > 0) {
            client.newBuilder()
                .callTimeout((timeoutSeconds * 1000.0).toLong(), TimeUnit.MILLISECONDS)
                .build()
        } else {
            client
        }

        val call = callClient.newCall(builder.build())
        calls[requestId] = call

        call.enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                calls.remove(requestId)
                val error = if (call.isCanceled()) {
                     mapOf("error" to "aborted", "message" to "Request aborted")
                } else {
                     mapOf("error" to "network_error", "message" to (e.message ?: "unknown"))
                }
                runtime.emitEvent("zynth.fetch.response", error + mapOf("requestId" to requestId))
            }

            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                if (wantsStream) {
                    val headerMap = JSONObject()
                    for (name in response.headers.names()) {
                        val values = response.headers.values(name)
                        headerMap.put(name, values.joinToString(", "))
                    }
                    val result = JSONObject()
                        .put("status", response.code)
                        .put("statusText", response.message)
                        .put("ok", response.isSuccessful)
                        .put("url", response.request.url.toString())
                        .put("redirected", response.priorResponse != null)
                        .put("headers", headerMap)
                        .put("streamId", requestId)
                    startStreamReader(requestId, requestId, response)
                    runtime.emitEvent("zynth.fetch.response", mapOf("requestId" to requestId, "result" to result))
                } else {
                    response.use { closedResponse ->
                        val bodyBytes = closedResponse.body?.bytes() ?: ByteArray(0)
                        val bodyJson = JSONArray()
                        for (byte in bodyBytes) {
                            bodyJson.put(byte.toInt() and 0xff)
                        }
                        val headerMap = JSONObject()
                        for (name in closedResponse.headers.names()) {
                            val values = closedResponse.headers.values(name)
                            headerMap.put(name, values.joinToString(", "))
                        }
                        val result = JSONObject()
                            .put("status", closedResponse.code)
                            .put("statusText", closedResponse.message)
                            .put("ok", closedResponse.isSuccessful)
                            .put("url", closedResponse.request.url.toString())
                            .put("redirected", closedResponse.priorResponse != null)
                            .put("headers", headerMap)
                            .put("body", bodyJson)
                        runtime.emitEvent("zynth.fetch.response", mapOf("requestId" to requestId, "result" to result))
                    }
                    calls.remove(requestId)
                }
            }
        })

        return JSONObject().put("requestId", requestId)
    }

    private fun handleCancel(payload: Any?): JSONObject {
        val params = payload as? JSONObject ?: return errorResponse("invalid_arguments")
        if (!params.has("id")) return errorResponse("missing_request_id")
        val requestId = params.getInt("id")
        calls.remove(requestId)?.cancel()
        return JSONObject().put("result", true)
    }

    private fun handleStreamStart(payload: Any?): JSONObject {
        val params = payload as? JSONObject ?: return errorResponse("invalid_arguments")
        if (!params.has("id")) return errorResponse("missing_request_id")
        val streamId = params.getInt("id")
        startedStreams[streamId] = true
        flushPending(streamId)
        return JSONObject().put("result", true)
    }

    private fun startStreamReader(requestId: Int, streamId: Int, response: okhttp3.Response) {
        val body = response.body
        if (body == null) {
            emitStream(streamId, mapOf("id" to streamId, "type" to "end"))
            response.close()
            calls.remove(requestId)
            return
        }
        Thread {
            val buffer = ByteArray(16 * 1024)
            try {
                val input = body.byteStream()
                while (true) {
                    val count = input.read(buffer)
                    if (count <= 0) break
                    val chunk = buffer.copyOf(count)
                    emitStream(streamId, mapOf("id" to streamId, "type" to "chunk", "chunk" to chunk))
                }
                emitStream(streamId, mapOf("id" to streamId, "type" to "end"))
            } catch (t: Throwable) {
                emitStream(
                    streamId,
                    mapOf("id" to streamId, "type" to "error", "message" to (t.message ?: "stream_error")),
                )
            } finally {
                response.close()
                calls.remove(requestId)
            }
        }.start()
    }

    private fun emitStream(streamId: Int, payload: Map<String, Any>) {
        if (startedStreams[streamId] == true) {
            runtime.emitEvent("zynth.fetch.stream", payload)
            return
        }
        when (payload["type"]) {
            "chunk" -> {
                val list = pendingChunks.getOrPut(streamId) { mutableListOf() }
                val chunk = payload["chunk"] as? ByteArray
                if (chunk != null) {
                    list.add(chunk)
                }
            }
            "end" -> pendingEnd[streamId] = true
            "error" -> {
                val message = payload["message"]?.toString() ?: "stream_error"
                pendingError[streamId] = message
            }
        }
    }

    private fun flushPending(streamId: Int) {
        pendingChunks.remove(streamId)?.forEach { chunk ->
            runtime.emitEvent(
                "zynth.fetch.stream",
                mapOf("id" to streamId, "type" to "chunk", "chunk" to chunk),
            )
        }
        pendingError.remove(streamId)?.let { message ->
            runtime.emitEvent(
                "zynth.fetch.stream",
                mapOf("id" to streamId, "type" to "error", "message" to message),
            )
            return
        }
        if (pendingEnd.remove(streamId) == true) {
            runtime.emitEvent(
                "zynth.fetch.stream",
                mapOf("id" to streamId, "type" to "end"),
            )
        }
    }

    private fun errorResponse(error: String, message: String? = null): JSONObject {
        val obj = JSONObject().put("error", error)
        if (message != null) obj.put("message", message)
        return obj
    }

    private fun coerceBodyBytes(body: Any): ByteArray? {
        return when (body) {
            is ByteArray -> body
            is JSONArray -> {
                val bytes = ByteArray(body.length())
                for (i in 0 until body.length()) {
                    bytes[i] = body.getInt(i).toByte()
                }
                bytes
            }
            is ByteBuffer -> {
                val duplicate = body.slice()
                val bytes = ByteArray(duplicate.remaining())
                duplicate.get(bytes)
                bytes
            }
            is List<*> -> {
                val bytes = ByteArray(body.size)
                for (i in body.indices) {
                    val value = body[i] as? Number ?: return null
                    bytes[i] = value.toInt().toByte()
                }
                bytes
            }
            else -> null
        }
    }
}
