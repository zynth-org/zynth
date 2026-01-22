package dev.zynth.apis

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
        val map = payload as? Map<*, *> ?: return errorResponse("invalid_arguments")
        val requestId = (map["requestId"] as? Number)?.toInt()
            ?: return errorResponse("missing_request_id")
        val url = map["url"]?.toString()?.takeIf { it.isNotBlank() }
            ?: return errorResponse("invalid_url")

        val method = map["method"]?.toString()?.uppercase() ?: "GET"
        val headers = map["headers"] as? Map<*, *>
        val timeoutSeconds = (map["timeout"] as? Number)?.toDouble() ?: 0.0
        val wantsStream = map["stream"] as? Boolean ?: false

        val builder = Request.Builder().url(url)
        if (headers != null) {
            for (entry in headers.entries) {
                val key = entry.key
                val value = entry.value
                if (key != null && value != null) {
                    builder.header(key.toString(), value.toString())
                }
            }
        }

        val body = map["body"]
        if (body != null) {
            val mediaType = headers?.get("Content-Type")?.toString()?.toMediaTypeOrNull()
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

        return try {
            val call = callClient.newCall(builder.build())
            calls[requestId] = call
            val response = call.execute()
            if (wantsStream) {
                val headerMap = mutableMapOf<String, String>()
                for (name in response.headers.names()) {
                    val values = response.headers.values(name)
                    headerMap[name] = values.joinToString(", ")
                }
                val result = JSONObject()
                    .put("status", response.code)
                    .put("statusText", response.message)
                    .put("ok", response.isSuccessful)
                    .put("url", response.request.url.toString())
                    .put("redirected", response.priorResponse != null)
                    .put("headers", JSONObject(headerMap as Map<*, *>))
                    .put("streamId", requestId)
                startStreamReader(requestId, requestId, response)
                JSONObject().put("result", result)
            } else {
                response.use { closedResponse ->
                    val bodyBytes = closedResponse.body?.bytes() ?: ByteArray(0)
                    val bodyJson = JSONArray()
                    for (byte in bodyBytes) {
                        bodyJson.put(byte.toInt() and 0xff)
                    }
                    val headerMap = mutableMapOf<String, String>()
                    for (name in closedResponse.headers.names()) {
                        val values = closedResponse.headers.values(name)
                        headerMap[name] = values.joinToString(", ")
                    }
                    val result = JSONObject()
                        .put("status", closedResponse.code)
                        .put("statusText", closedResponse.message)
                        .put("ok", closedResponse.isSuccessful)
                        .put("url", closedResponse.request.url.toString())
                        .put("redirected", closedResponse.priorResponse != null)
                        .put("headers", JSONObject(headerMap as Map<*, *>))
                        .put("body", bodyJson)
                    JSONObject().put("result", result)
                }
            }
        } catch (t: Throwable) {
            return if (t is java.io.IOException && (t.message?.contains("Canceled", true) == true)) {
                errorResponse("aborted", "Request aborted")
            } else {
                errorResponse("network_error", t.message ?: "unknown")
            }
        } finally {
            calls.remove(requestId)
        }
    }

    private fun handleCancel(payload: Any?): JSONObject {
        val map = payload as? Map<*, *> ?: return errorResponse("invalid_arguments")
        val requestId = (map["id"] as? Number)?.toInt()
            ?: return errorResponse("missing_request_id")
        calls.remove(requestId)?.cancel()
        return JSONObject().put("result", true)
    }

    private fun handleStreamStart(payload: Any?): JSONObject {
        val map = payload as? Map<*, *> ?: return errorResponse("invalid_arguments")
        val streamId = (map["id"] as? Number)?.toInt()
            ?: return errorResponse("missing_request_id")
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
