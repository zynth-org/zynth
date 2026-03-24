package com.zynth.kit.runtime.modules

import android.net.Uri
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthTypeException
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject

class FetchModule(private val runtime: ZynthRuntime) : ZynthModule {
    override val name: String = "Fetch"

    override val exportedMethods: List<String> = listOf(
        "request",
        "cancel",
        "streamStart",
        "uploadChunk",
        "uploadComplete",
        "uploadAbort",
    )

    private val client = OkHttpClient.Builder().build()
    private val calls = ConcurrentHashMap<Int, okhttp3.Call>()
    private val pendingChunks = ConcurrentHashMap<Int, MutableList<ByteArray>>()
    private val pendingEnd = ConcurrentHashMap<Int, Boolean>()
    private val pendingError = ConcurrentHashMap<Int, String>()
    private val startedStreams = ConcurrentHashMap<Int, Boolean>()
    private val uploadChannels = ConcurrentHashMap<Int, UploadChannel>()
    private val tlsClientCache = ConcurrentHashMap<String, OkHttpClient>()

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "request" -> handleRequest(args)
            "cancel" -> handleCancel(args)
            "streamStart" -> handleStreamStart(args)
            "uploadChunk" -> handleUploadChunk(args)
            "uploadComplete" -> handleUploadComplete(args)
            "uploadAbort" -> handleUploadAbort(args)
            else -> errorResponse("unknown_method", method)
        }
    }

    private fun handleRequest(args: ZynthArgs): JSONObject {
        val requestId = args.getInt("requestId")

        val url = args.getString("url")
        if (url.isBlank()) return errorResponse("invalid_url")

        val method = args.getString("method", "GET").uppercase()
        val headers = try { args.getMap("headers") } catch (e: Exception) { null }
        val timeoutSeconds = args.getDouble("timeout", 0.0)
        val wantsStream = args.getBoolean("stream", false)
        val uploadStream = args.getBoolean("uploadStream", false)
        val uploadLength = args.getOptionalLong("uploadLength")?.takeIf { it >= 0 }
        val bodyFileUri = args.getOptionalString("bodyFileUri")?.trim()?.takeIf { it.isNotEmpty() }
        val trustedCertificatesPem = parseTrustedCertificatesPem(args)

        val builder = Request.Builder().url(url)
        if (headers != null) {
            for ((key, value) in headers) {
                val valueStr = value?.toString() ?: ""
                if (valueStr.isNotEmpty()) {
                    builder.header(key, valueStr)
                }
            }
        }

        if (bodyFileUri != null) {
            if (method == "GET" || method == "HEAD") {
                return errorResponse("invalid_method", "bodyFileUri requires a request body method")
            }
            val mediaType = (headers?.get("Content-Type") as? String)?.toMediaTypeOrNull()
            val filePath = resolveBodyFilePath(bodyFileUri) ?: return errorResponse("invalid_body_file_uri")
            val file = File(filePath)
            if (!file.exists() || !file.isFile) {
                return errorResponse("invalid_body_file_uri", "bodyFileUri does not point to an existing file")
            }
            builder.method(method, createFileRequestBody(file, mediaType))
        } else if (uploadStream) {
            if (method == "GET" || method == "HEAD") {
                return errorResponse("invalid_method", "uploadStream requires a request body method")
            }
            val mediaType = (headers?.get("Content-Type") as? String)?.toMediaTypeOrNull()
            val channel = UploadChannel(mediaType, uploadLength)
            uploadChannels[requestId] = channel
            builder.method(method, channel.requestBody())
        } else if (args.has("body")) {
            val body = args.getAny("body")
            val mediaType = (headers?.get("Content-Type") as? String)?.toMediaTypeOrNull()
            val bytes = body?.let { coerceBodyBytes(it) }
            if (bytes != null) {
                builder.method(method, bytes.toRequestBody(mediaType))
            } else if (body is String) {
                val stringType = mediaType ?: "text/plain; charset=utf-8".toMediaTypeOrNull()
                builder.method(method, body.toRequestBody(stringType))
            } else {
                return errorResponse("unsupported_body", body?.let { it::class.java.name } ?: "null")
            }
        } else {
            builder.method(
                method,
                if (method == "GET" || method == "HEAD") null else ByteArray(0).toRequestBody(),
            )
        }

        val callClient = resolveCallClient(timeoutSeconds, trustedCertificatesPem)

        val call = callClient.newCall(builder.build())
        calls[requestId] = call

        call.enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: IOException) {
                calls.remove(requestId)
                uploadChannels.remove(requestId)?.abort("Request failed")
                val error: Map<String, Any> = if (call.isCanceled()) {
                    mapOf("error" to "aborted", "message" to "Request aborted")
                } else {
                    mapOf("error" to "network_error", "message" to (e.message ?: "unknown"))
                }
                runtime.emitEvent("zynth.fetch.response", error + mapOf<String, Any>("requestId" to requestId))
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
                    runtime.emitEvent(
                        "zynth.fetch.response",
                        mapOf("requestId" to requestId, "result" to result),
                    )
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
                        runtime.emitEvent(
                            "zynth.fetch.response",
                            mapOf("requestId" to requestId, "result" to result),
                        )
                    }
                    calls.remove(requestId)
                    uploadChannels.remove(requestId)
                }
            }
        })

        return JSONObject().put("requestId", requestId)
    }

    private fun handleCancel(args: ZynthArgs): JSONObject {
        val requestId = args.getInt("id")
        uploadChannels.remove(requestId)?.abort("Request aborted")
        calls.remove(requestId)?.cancel()
        return JSONObject().put("result", true)
    }

    private fun handleStreamStart(args: ZynthArgs): JSONObject {
        val streamId = args.getInt("id")
        startedStreams[streamId] = true
        flushPending(streamId)
        return JSONObject().put("result", true)
    }

    private fun handleUploadChunk(args: ZynthArgs): JSONObject {
        val requestId = args.getInt("id")
        val channel = uploadChannels[requestId] ?: return errorResponse("upload_not_found")
        val chunk = args.getAny("chunk")?.let { coerceBodyBytes(it) } ?: return errorResponse("unsupported_chunk")

        return try {
            channel.enqueue(chunk)
            JSONObject().put("result", true)
        } catch (error: Throwable) {
            errorResponse("upload_failed", error.message)
        }
    }

    private fun handleUploadComplete(args: ZynthArgs): JSONObject {
        val requestId = args.getInt("id")
        val channel = uploadChannels[requestId] ?: return errorResponse("upload_not_found")

        return try {
            channel.complete()
            JSONObject().put("result", true)
        } catch (error: Throwable) {
            errorResponse("upload_failed", error.message)
        }
    }

    private fun handleUploadAbort(args: ZynthArgs): JSONObject {
        val requestId = args.getInt("id")
        val reason = args.getOptionalString("message") ?: "Upload aborted"

        uploadChannels.remove(requestId)?.abort(reason)
        calls.remove(requestId)?.cancel()
        return JSONObject().put("result", true)
    }

    private fun startStreamReader(requestId: Int, streamId: Int, response: okhttp3.Response) {
        val body = response.body
        if (body == null) {
            emitStream(streamId, mapOf("id" to streamId, "type" to "end"))
            response.close()
            calls.remove(requestId)
            uploadChannels.remove(requestId)
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
                uploadChannels.remove(requestId)
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

    private fun parseTrustedCertificatesPem(args: ZynthArgs): List<String> {
        if (!args.has("tls")) {
            return emptyList()
        }
        val tlsConfig = try {
            args.getMap("tls")
        } catch (_: Exception) {
            throw IllegalArgumentException("tls must be an object")
        }
        val rawCertificates = tlsConfig["trustedCertificatesPem"] ?: return emptyList()

        val sources = when (rawCertificates) {
            is String -> listOf(rawCertificates)
            is List<*> -> {
                val parsed = mutableListOf<String>()
                for (entry in rawCertificates) {
                    if (entry !is String) {
                        throw IllegalArgumentException(
                            "tls.trustedCertificatesPem array must contain only PEM strings"
                        )
                    }
                    parsed.add(entry)
                }
                parsed
            }
            else -> throw IllegalArgumentException(
                "tls.trustedCertificatesPem must be a PEM string or array of PEM strings"
            )
        }

        if (sources.isEmpty()) {
            return emptyList()
        }

        val certificates = mutableListOf<String>()
        for (source in sources) {
            val blocks = extractCertificateBlocks(source)
            if (blocks.isEmpty()) {
                throw IllegalArgumentException(
                    "tls.trustedCertificatesPem must include at least one CERTIFICATE block"
                )
            }
            certificates.addAll(blocks)
        }
        return certificates
    }

    private fun resolveCallClient(timeoutSeconds: Double, trustedCertificatesPem: List<String>): OkHttpClient {
        val timeoutMs = if (timeoutSeconds > 0) {
            (timeoutSeconds * 1000.0).toLong()
        } else {
            0L
        }

        if (trustedCertificatesPem.isEmpty()) {
            return if (timeoutMs > 0) {
                client.newBuilder()
                    .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .build()
            } else {
                client
            }
        }

        val certKey = trustedCertificatesPem.joinToString(separator = "\n")
        val pinnedClient = tlsClientCache.getOrPut(certKey) {
            val trustManager = buildTrustManager(trustedCertificatesPem)
            val sslContext = SSLContext.getInstance("TLS")
            sslContext.init(null, arrayOf(trustManager), SecureRandom())
            client.newBuilder()
                .sslSocketFactory(sslContext.socketFactory, trustManager)
                .build()
        }

        return if (timeoutMs > 0) {
            pinnedClient.newBuilder()
                .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build()
        } else {
            pinnedClient
        }
    }

    private fun buildTrustManager(certificatesPem: List<String>): X509TrustManager {
        val keyStore = KeyStore.getInstance(KeyStore.getDefaultType())
        keyStore.load(null, null)
        val certificateFactory = CertificateFactory.getInstance("X.509")

        var inserted = 0
        for (pem in certificatesPem) {
            val bytes = pem.toByteArray(StandardCharsets.US_ASCII)
            val certificate = certificateFactory.generateCertificate(
                ByteArrayInputStream(bytes)
            ) as X509Certificate
            keyStore.setCertificateEntry("zynth-fetch-trust-$inserted", certificate)
            inserted += 1
        }

        if (inserted == 0) {
            throw IllegalArgumentException("tls.trustedCertificatesPem resolved to zero certificates")
        }

        val trustManagerFactory = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm()
        )
        trustManagerFactory.init(keyStore)
        val trustManager = trustManagerFactory.trustManagers.firstOrNull { manager ->
            manager is X509TrustManager
        } as? X509TrustManager

        return trustManager
            ?: throw IllegalStateException("Failed to initialize X509TrustManager for fetch TLS override")
    }

    private fun extractCertificateBlocks(value: String): List<String> {
        val blocks = mutableListOf<String>()
        val regex = Regex(
            "-----BEGIN CERTIFICATE-----[\\s\\S]*?-----END CERTIFICATE-----",
            setOf(RegexOption.MULTILINE)
        )
        val matches = regex.findAll(value)
        for (match in matches) {
            val block = match.value.trim()
            if (block.isNotEmpty()) {
                blocks.add(block)
            }
        }
        return blocks
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

    private fun resolveBodyFilePath(uri: String): String? {
        if (uri.startsWith("file://")) {
            return runCatching { Uri.parse(uri).path }.getOrNull()
        }
        return if (uri.startsWith("/")) uri else null
    }

    private fun createFileRequestBody(file: File, mediaType: MediaType?): RequestBody {
        return object : RequestBody() {
            override fun contentType(): MediaType? = mediaType

            override fun contentLength(): Long = file.length()

            override fun writeTo(sink: BufferedSink) {
                FileInputStream(file).use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) {
                            break
                        }
                        sink.write(buffer, 0, read)
                    }
                }
            }
        }
    }

    private class UploadChannel(
        private val mediaType: MediaType?,
        private val length: Long?,
    ) {
        private val queue = LinkedBlockingQueue<UploadEvent>()
        @Volatile
        private var closed: Boolean = false

        fun requestBody(): RequestBody {
            return object : RequestBody() {
                override fun contentType(): MediaType? = mediaType

                override fun contentLength(): Long = length ?: -1L

                override fun writeTo(sink: BufferedSink) {
                    while (true) {
                        val event = queue.take()
                        when (event) {
                            is UploadEvent.Chunk -> sink.write(event.bytes)
                            is UploadEvent.Complete -> return
                            is UploadEvent.Abort -> throw IOException(event.message)
                        }
                    }
                }
            }
        }

        fun enqueue(bytes: ByteArray) {
            if (closed) {
                throw IOException("Upload is already closed")
            }
            queue.put(UploadEvent.Chunk(bytes))
        }

        fun complete() {
            if (closed) {
                return
            }
            closed = true
            queue.put(UploadEvent.Complete)
        }

        fun abort(message: String) {
            if (closed) {
                return
            }
            closed = true
            queue.put(UploadEvent.Abort(message))
        }

        private sealed class UploadEvent {
            data class Chunk(val bytes: ByteArray) : UploadEvent()
            object Complete : UploadEvent()
            data class Abort(val message: String) : UploadEvent()
        }
    }
}
