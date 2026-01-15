package dev.rune.webserver

import android.app.Activity
import org.json.JSONArray
import org.json.JSONObject
import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneSyncModule
import java.io.File

class RuneWebServerModule(
    private val activity: Activity
) : RuneModule, RuneSyncModule {
    override val name: String = "RuneWebServer"
    private var serverHandle: Long = 0
    private var serverInfo: JSONObject? = null

    override fun invalidate() {
        stopServer()
    }

    fun shutdown() {
        stopServer()
    }

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "start" -> startServer(args)
            "stop" -> {
                stopServer()
                successResponse()
            }
            "isRunning" -> resultResponse(isRunning())
            "getInfo" -> resultResponse(serverInfo ?: JSONObject.NULL)
            "drainEvents" -> drainEvents(args)
            else -> errorResponse("unsupported_method", method)
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "isRunning" -> isRunning()
            "getInfo" -> serverInfo ?: JSONObject.NULL
            else -> null
        }
    }

    private fun startServer(args: Array<Any?>): JSONObject {
        stopServer()

        val host = getStringArg(args, "host") ?: "0.0.0.0"
        val port = getIntArg(args, "port") ?: 0
        val documentRoot = getStringArg(args, "documentRoot")
        val indexHtml = getStringArg(args, "indexHtml")
        val uploadPath = getStringArg(args, "uploadPath")
        var uploadDir = getStringArg(args, "uploadDir")
        val maxUploadBytes = getLongArg(args, "maxUploadBytes") ?: 0L
        val eventsPath = getStringArg(args, "eventsPath")

        if (uploadPath != null && uploadDir == null) {
            uploadDir = File(activity.cacheDir, "rune-webserver").absolutePath
        }

        val handle = RuneWebServerNative.start(
            host,
            port,
            documentRoot,
            indexHtml,
            uploadPath,
            uploadDir,
            maxUploadBytes,
            eventsPath
        )
        if (handle == 0L) {
            return errorResponse("start_failed", "Failed to start web server")
        }

        serverHandle = handle
        val actualPort = RuneWebServerNative.getPort(handle)
        val info = JSONObject().apply {
            put("host", host)
            put("port", actualPort)
            put("url", "http://$host:$actualPort")
            put("documentRoot", documentRoot ?: JSONObject.NULL)
            put("uploadPath", uploadPath ?: JSONObject.NULL)
            put("eventsPath", eventsPath ?: JSONObject.NULL)
        }
        serverInfo = info
        return resultResponse(info)
    }

    private fun stopServer() {
        if (serverHandle != 0L) {
            RuneWebServerNative.stop(serverHandle)
            serverHandle = 0L
        }
        serverInfo = null
    }

    private fun isRunning(): Boolean {
        return serverHandle != 0L && RuneWebServerNative.isRunning(serverHandle)
    }

    private fun drainEvents(args: Array<Any?>): JSONObject {
        if (serverHandle == 0L) {
            return resultResponse(JSONArray())
        }
        val maxEvents = getIntArg(args, "maxEvents") ?: 50
        val events = RuneWebServerNative.drainEvents(serverHandle, maxEvents)
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

    private fun getParams(args: Array<Any?>): Any? {
        return args.getOrNull(0)
    }

    private fun getStringArg(args: Array<Any?>, key: String): String? {
        val params = getParams(args)
        return when (params) {
            is JSONObject -> {
                val value = params.opt(key)
                if (value == JSONObject.NULL) null else value as? String
            }
            is Map<*, *> -> params[key] as? String
            else -> null
        }
    }

    private fun getIntArg(args: Array<Any?>, key: String): Int? {
        val params = getParams(args)
        val value = when (params) {
            is JSONObject -> params.opt(key)
            is Map<*, *> -> params[key]
            else -> null
        }
        return when (value) {
            is Number -> value.toInt()
            is String -> value.toIntOrNull()
            else -> null
        }
    }

    private fun getLongArg(args: Array<Any?>, key: String): Long? {
        val params = getParams(args)
        val value = when (params) {
            is JSONObject -> params.opt(key)
            is Map<*, *> -> params[key]
            else -> null
        }
        return when (value) {
            is Number -> value.toLong()
            is String -> value.toLongOrNull()
            else -> null
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
