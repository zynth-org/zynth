package dev.zynth.webserver

import android.app.Activity
import org.json.JSONArray
import org.json.JSONObject
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import java.io.File
import java.security.MessageDigest

class ZynthWebServerModule(
    private val activity: Activity
) : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthWebServer"
    private var serverHandle: Long = 0
    private var serverInfo: JSONObject? = null

    override val exportedMethods: List<String> = listOf(
        "start",
        "stop",
        "isRunning",
        "getInfo",
        "getUploadState",
        "drainEvents",
        "upsertManagedTlsCertificate",
        "setSignal",
        "getSignal",
        "setReply",
        "getReply"
    )
    override val protectedMethods: List<String> = listOf("start", "stop")

    override fun invalidate() {
        stopServer()
    }

    fun shutdown() {
        stopServer()
    }

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "start" -> startServer(args)
            "stop" -> {
                stopServer()
                resultResponse(true)
            }
            "isRunning" -> resultResponse(isRunning())
            "getInfo" -> resultResponse(serverInfo ?: JSONObject.NULL)
            "getUploadState" -> resultResponse(getUploadState())
            "drainEvents" -> drainEvents(args)
            "upsertManagedTlsCertificate" -> upsertManagedTlsCertificate(args)
            "setSignal" -> setSignal(args)
            "getSignal" -> getSignal(args)
            "setReply" -> setReply(args)
            "getReply" -> getReply(args)
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "isRunning" -> isRunning()
            "getInfo" -> serverInfo ?: JSONObject.NULL
            "getUploadState" -> getUploadState()
            "getSignal" -> getSignal(args).get("result")
            "getReply" -> getReply(args).get("result")
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun startServer(args: ZynthArgs): JSONObject {
        stopServer()

        val host = args.getString("host", "0.0.0.0")
        val port = args.getInt("port", 0)
        val tlsEnabled = args.getBoolean("tlsEnabled", false)
        val tlsCertificate = args.getOptionalString("tlsCertificate")
        val documentRoot = args.getOptionalString("documentRoot")
        val indexHtml = args.getOptionalString("indexHtml")
        val uploadPath = args.getOptionalString("uploadPath")
        var uploadDir = args.getOptionalString("uploadDir")
        val uploadMetadataPath = args.getOptionalString("uploadMetadataPath")
        val uploadAuthToken = args.getOptionalString("uploadAuthToken")
        val uploadAuthHeader = args.getOptionalString("uploadAuthHeader")
        val uploadAuthQueryKey = args.getOptionalString("uploadAuthQueryKey")
        val maxUploadBytes = (try { args.getDouble("maxUploadBytes").toLong() } catch (e: Exception) { 0L })
        val eventsPath = args.getOptionalString("eventsPath")

        if (uploadPath != null && uploadDir == null) {
            uploadDir = File(activity.cacheDir, "zynth-webserver").absolutePath
        }

        if (tlsEnabled && !ZynthWebServerNative.supportsTls()) {
            if (BuildConfig.ZYNTH_WEBSERVER_TLS_REQUESTED) {
                throw IllegalStateException(
                    "TLS was requested for @zynth/webserver, but the Android native build could not compile a TLS backend. The native build fell back to NO_SSL; HTTPS is unavailable."
                )
            }
            throw IllegalStateException(
                "TLS is not available in this ZynthWebServer build. Enable @zynth/webserver nativeTls in app.json and rebuild native modules."
            )
        }
        if (tlsEnabled && tlsCertificate.isNullOrBlank()) {
            throw IllegalArgumentException("tlsCertificate is required when tlsEnabled=true")
        }

        val handle = ZynthWebServerNative.start(
            host,
            port,
            tlsEnabled,
            tlsCertificate,
            documentRoot,
            indexHtml,
            uploadPath,
            uploadDir,
            uploadMetadataPath,
            uploadAuthToken,
            uploadAuthHeader,
            uploadAuthQueryKey,
            maxUploadBytes,
            eventsPath
        )
        if (handle == 0L) {
            val detail = ZynthWebServerNative.getLastError()?.trim().orEmpty()
            if (detail.isNotEmpty()) {
                throw IllegalStateException("Failed to start web server ($detail)")
            }
            throw IllegalStateException("Failed to start web server")
        }

        serverHandle = handle
        val actualPort = ZynthWebServerNative.getPort(handle)
        val info = JSONObject().apply {
            put("host", host)
            put("port", actualPort)
            put("url", "${if (tlsEnabled) "https" else "http"}://$host:$actualPort")
            put("scheme", if (tlsEnabled) "https" else "http")
            put("secureTransport", tlsEnabled)
            put("documentRoot", documentRoot ?: JSONObject.NULL)
            put("uploadPath", uploadPath ?: JSONObject.NULL)
            put("uploadMetadataPath", uploadMetadataPath ?: JSONObject.NULL)
            put("eventsPath", eventsPath ?: JSONObject.NULL)
            put("signalPath", "/__zynth/signal")
            put("replyPath", "/__zynth/reply")
        }
        serverInfo = info
        return resultResponse(info)
    }

    private fun stopServer() {
        if (serverHandle != 0L) {
            ZynthWebServerNative.stop(serverHandle)
            serverHandle = 0L
        }
        serverInfo = null
    }

    private fun isRunning(): Boolean {
        return serverHandle != 0L && ZynthWebServerNative.isRunning(serverHandle)
    }

    private fun drainEvents(args: ZynthArgs): JSONObject {
        if (serverHandle == 0L) {
            return resultResponse(JSONArray())
        }
        val maxEvents = args.getInt("maxEvents", 50)
        val events = ZynthWebServerNative.drainEvents(serverHandle, maxEvents)
        val array = JSONArray()
        for (event in events) {
            array.put(
                JSONObject().apply {
                    put("type", event.type)
                    put("payload", event.payload)
                }
            )
        }
        return resultResponse(array)
    }

    private fun getUploadState(): JSONObject {
        if (serverHandle == 0L) {
            return JSONObject()
                .put("activeCount", 0)
                .put("totalStarted", 0)
                .put("totalCompleted", 0)
                .put("totalFailed", 0)
                .put("totalBytesReceived", 0)
                .put("activeUploads", JSONArray())
        }

        val raw = ZynthWebServerNative.getUploadStateJson(serverHandle)
        if (raw.isNullOrBlank()) {
            return JSONObject()
                .put("activeCount", 0)
                .put("totalStarted", 0)
                .put("totalCompleted", 0)
                .put("totalFailed", 0)
                .put("totalBytesReceived", 0)
                .put("activeUploads", JSONArray())
        }

        return try {
            JSONObject(raw)
        } catch (_: Throwable) {
            JSONObject()
                .put("activeCount", 0)
                .put("totalStarted", 0)
                .put("totalCompleted", 0)
                .put("totalFailed", 0)
                .put("totalBytesReceived", 0)
                .put("activeUploads", JSONArray())
        }
    }

    private fun setReply(args: ZynthArgs): JSONObject {
        return setSignal(args)
    }

    private fun upsertManagedTlsCertificate(args: ZynthArgs): JSONObject {
        val aliasRaw = args.getString("alias", "default").trim()
        val alias = sanitizeAlias(if (aliasRaw.isEmpty()) "default" else aliasRaw)
        val generateIfMissing = args.getBoolean("generateIfMissing", false)
        val commonName = args.getString("commonName", "localhost").trim().ifEmpty { "localhost" }
        val validDays = args.getInt("validDays", 365).coerceIn(1, 3650)
        var pem = args.getString("pem", "").trim()
        if (pem.isEmpty() && generateIfMissing) {
            val generatedPem = ZynthWebServerNative.generateSelfSignedPem(commonName, validDays)
            if (generatedPem.isNullOrBlank()) {
                val detail = ZynthWebServerNative.getLastError()?.trim().orEmpty()
                if (detail.isNotEmpty()) {
                    throw IllegalStateException("Failed to generate self-signed certificate ($detail)")
                }
                throw IllegalStateException("Failed to generate self-signed certificate")
            }
            pem = generatedPem.trim()
        }
        if (pem.isEmpty()) {
            throw IllegalArgumentException("pem is required (or set generateIfMissing=true)")
        }

        val rotateAfterMs = try {
            args.getDouble("rotateAfterMs").toLong()
        } catch (_: Exception) {
            30L * 24L * 60L * 60L * 1000L
        }
        val normalizedRotateAfterMs = rotateAfterMs.coerceAtLeast(1L)

        val tlsDir = File(activity.cacheDir, "zynth-webserver/tls")
        if (!tlsDir.exists() && !tlsDir.mkdirs()) {
            throw IllegalStateException("Unable to create managed TLS directory")
        }
        val pemFile = File(tlsDir, "$alias.pem")
        val metadataFile = File(tlsDir, "$alias.meta")
        val now = System.currentTimeMillis()
        val fingerprint = sha256Hex(pem)

        var existed = pemFile.exists()
        var shouldRewrite = true
        if (existed) {
            val existingPem = runCatching { pemFile.readText(Charsets.UTF_8) }.getOrNull()
            val lastUpdatedAt = parseUpdatedAt(metadataFile)
            val hasExpired = (now - lastUpdatedAt) >= normalizedRotateAfterMs
            shouldRewrite = existingPem != pem || hasExpired
        }

        if (shouldRewrite) {
            pemFile.writeText(pem, Charsets.UTF_8)
            metadataFile.writeText(now.toString(), Charsets.UTF_8)
        }

        val updatedAt = if (shouldRewrite) now else parseUpdatedAt(metadataFile)
        return resultResponse(
            JSONObject()
                .put("alias", alias)
                .put("certificatePath", pemFile.absolutePath)
                .put("fingerprintSha256", fingerprint)
                .put("updatedAt", updatedAt)
                .put("existed", existed)
        )
    }

    private fun getReply(args: ZynthArgs): JSONObject {
        return getSignal(args)
    }

    private fun setSignal(args: ZynthArgs): JSONObject {
        if (serverHandle == 0L) {
            return resultResponse(false)
        }
        val key = args.getString("key", "").trim()
        if (key.isEmpty()) {
            return resultResponse(false)
        }
        val payloadJson = args.getString("payloadJson", "null")
        val ok = ZynthWebServerNative.setReply(serverHandle, key, payloadJson)
        return resultResponse(ok)
    }

    private fun getSignal(args: ZynthArgs): JSONObject {
        if (serverHandle == 0L) {
            return resultResponse(JSONObject.NULL)
        }
        val key = args.getString("key", "").trim()
        if (key.isEmpty()) {
            return resultResponse(JSONObject.NULL)
        }
        val consume = args.getBoolean("consume", true)
        val raw = ZynthWebServerNative.getReplyJson(serverHandle, key, consume)
        if (raw.isNullOrBlank()) {
            return resultResponse(JSONObject.NULL)
        }
        return try {
            resultResponse(JSONObject(raw))
        } catch (_: Throwable) {
            try {
                resultResponse(JSONArray(raw))
            } catch (_: Throwable) {
                resultResponse(raw)
            }
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().apply {
            put("result", result ?: JSONObject.NULL)
        }
    }

    private fun sanitizeAlias(value: String): String {
        val out = StringBuilder(value.length)
        for (char in value) {
            when {
                char in 'a'..'z' -> out.append(char)
                char in 'A'..'Z' -> out.append(char)
                char in '0'..'9' -> out.append(char)
                char == '-' || char == '_' || char == '.' -> out.append(char)
                else -> out.append('_')
            }
        }
        return out.toString().ifEmpty { "default" }
    }

    private fun parseUpdatedAt(file: File): Long {
        if (!file.exists()) {
            return 0L
        }
        return runCatching {
            file.readText(Charsets.UTF_8).trim().toLong()
        }.getOrDefault(0L)
    }

    private fun sha256Hex(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        val output = StringBuilder(digest.size * 2)
        for (byte in digest) {
            val unsignedValue = byte.toInt() and 0xff
            if (unsignedValue < 16) {
                output.append('0')
            }
            output.append(unsignedValue.toString(16))
        }
        return output.toString()
    }
}
