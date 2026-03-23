package dev.zynth.webserver

import android.app.Activity
import org.json.JSONArray
import org.json.JSONObject
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import java.io.File

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
}
