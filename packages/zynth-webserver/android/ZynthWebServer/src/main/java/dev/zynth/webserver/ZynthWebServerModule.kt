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
                successResponse()
            }
            "isRunning" -> resultResponse(isRunning())
            "getInfo" -> resultResponse(serverInfo ?: JSONObject.NULL)
            "getUploadState" -> resultResponse(getUploadState())
            "drainEvents" -> drainEvents(args)
            else -> errorResponse("unsupported_method", method)
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "isRunning" -> isRunning()
            "getInfo" -> serverInfo ?: JSONObject.NULL
            "getUploadState" -> getUploadState()
            else -> null
        }
    }

    private fun startServer(args: ZynthArgs): JSONObject {
        stopServer()

        val host = args.getString("host", "0.0.0.0")
        val port = args.getInt("port", 0)
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

        val handle = ZynthWebServerNative.start(
            host,
            port,
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
            return errorResponse("start_failed", "Failed to start web server")
        }

        serverHandle = handle
        val actualPort = ZynthWebServerNative.getPort(handle)
        val info = JSONObject().apply {
            put("host", host)
            put("port", actualPort)
            put("url", "http://$host:$actualPort")
            put("documentRoot", documentRoot ?: JSONObject.NULL)
            put("uploadPath", uploadPath ?: JSONObject.NULL)
            put("uploadMetadataPath", uploadMetadataPath ?: JSONObject.NULL)
            put("eventsPath", eventsPath ?: JSONObject.NULL)
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

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().apply {
            put("result", result ?: JSONObject.NULL)
        }
    }

    private fun successResponse(): JSONObject {
        return JSONObject().apply {
            put("success", true)
        }
    }

    private fun errorResponse(error: String, message: String): JSONObject {
        return JSONObject().apply {
            put("error", error)
            put("message", message)
        }
    }
}
