package dev.zynth.documentpicker

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResultLauncher
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

class DocumentPickerModule(
    private val runtime: ZynthRuntime,
    private val activity: Activity
) : ZynthModule {
    override val name = "DocumentPicker"

    var openDocumentLauncher: ActivityResultLauncher<Array<String>>? = null
    var openMultipleDocumentsLauncher: ActivityResultLauncher<Array<String>>? = null

    private var pendingRequestId: String? = null
    private var pendingCopyToCacheDirectory: Boolean = true

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "pickDocumentAsync" -> pickDocumentAsync(args)
            else -> errorResponse("unsupported_method", method)
        }
    }

    private fun pickDocumentAsync(args: Array<Any?>): JSONObject {
        if (pendingRequestId != null) {
            return errorResponse("busy", "Another picker request is already active")
        }

        val requestId = getRequestId(args)
        val options = parseOptions(args)
        pendingRequestId = requestId
        pendingCopyToCacheDirectory = options.copyToCacheDirectory

        val mimeTypes = if (options.mimeTypes.isEmpty()) arrayOf("*/*") else options.mimeTypes.toTypedArray()

        return try {
            if (options.multiple) {
                val launcher = openMultipleDocumentsLauncher
                    ?: return errorResponse("not_initialized", "OpenMultipleDocuments launcher not initialized")
                launcher.launch(mimeTypes)
            } else {
                val launcher = openDocumentLauncher
                    ?: return errorResponse("not_initialized", "OpenDocument launcher not initialized")
                launcher.launch(mimeTypes)
            }
            JSONObject().put("status", "pending")
        } catch (error: Throwable) {
            pendingRequestId = null
            errorResponse("launch_failed", error.message ?: "Failed to launch document picker")
        }
    }

    fun onSingleDocumentResult(uri: Uri?) {
        if (uri == null) {
            emitResult(cancelled = true, assets = JSONArray())
            return
        }
        val assets = JSONArray()
        buildAsset(uri)?.let { assets.put(it) }
        emitResult(cancelled = false, assets = assets)
    }

    fun onMultipleDocumentsResult(uris: List<Uri>) {
        if (uris.isEmpty()) {
            emitResult(cancelled = true, assets = JSONArray())
            return
        }
        val assets = JSONArray()
        for (uri in uris) {
            buildAsset(uri)?.let { assets.put(it) }
        }
        emitResult(cancelled = false, assets = assets)
    }

    private fun buildAsset(uri: Uri): JSONObject? {
        val resolver = activity.contentResolver
        val (name, size) = readMeta(uri)
        val mimeType = resolver.getType(uri)
        val finalUri = if (pendingCopyToCacheDirectory) {
            copyToCache(uri, name)
        } else {
            uri.toString()
        }

        return JSONObject().apply {
            put("uri", finalUri)
            put("name", name ?: JSONObject.NULL)
            put("mimeType", mimeType ?: JSONObject.NULL)
            put("size", size ?: JSONObject.NULL)
        }
    }

    private fun readMeta(uri: Uri): Pair<String?, Long?> {
        val resolver = activity.contentResolver
        var name: String? = null
        var size: Long? = null

        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIndex >= 0) {
                        name = cursor.getString(nameIndex)
                    }
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                        size = cursor.getLong(sizeIndex)
                    }
                }
            }

        return Pair(name, size)
    }

    private fun copyToCache(uri: Uri, name: String?): String {
        val resolver = activity.contentResolver
        val cacheDir = File(activity.cacheDir, "zynth-document-picker")
        if (!cacheDir.exists()) {
            cacheDir.mkdirs()
        }

        val baseName = if (!name.isNullOrBlank()) name else "document"
        val safeName = baseName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val destination = File(cacheDir, "${UUID.randomUUID()}-$safeName")

        val input = resolver.openInputStream(uri) ?: return uri.toString()
        input.use {
            destination.outputStream().use { output ->
                it.copyTo(output)
            }
        }

        return Uri.fromFile(destination).toString()
    }

    private fun getRequestId(args: Array<Any?>): String {
        val params = getParams(args)
        return when (params) {
            is JSONObject -> params.optString("requestId", UUID.randomUUID().toString())
            is Map<*, *> -> (params["requestId"] as? String) ?: UUID.randomUUID().toString()
            else -> UUID.randomUUID().toString()
        }
    }

    private data class PickerOptions(
        val multiple: Boolean,
        val mimeTypes: List<String>,
        val copyToCacheDirectory: Boolean
    )

    private fun parseOptions(args: Array<Any?>): PickerOptions {
        val params = getParams(args)
        val options = when (params) {
            is JSONObject -> params.opt("options")
            is Map<*, *> -> params["options"]
            else -> null
        }

        val multiple = getBoolean(options, "multiple", false)
        val copyToCacheDirectory = getBoolean(options, "copyToCacheDirectory", true)
        val mimeTypes = getMimeTypes(options)
        return PickerOptions(
            multiple = multiple,
            mimeTypes = mimeTypes,
            copyToCacheDirectory = copyToCacheDirectory
        )
    }

    private fun getMimeTypes(options: Any?): List<String> {
        val rawType = when (options) {
            is JSONObject -> options.opt("type")
            is Map<*, *> -> options["type"]
            else -> null
        }

        return when (rawType) {
            is String -> listOf(rawType)
            is JSONArray -> {
                val values = mutableListOf<String>()
                for (index in 0 until rawType.length()) {
                    val value = rawType.optString(index, "")
                    if (value.isNotBlank()) {
                        values.add(value)
                    }
                }
                values
            }
            is List<*> -> rawType.filterIsInstance<String>()
            else -> emptyList()
        }
    }

    private fun getBoolean(options: Any?, key: String, fallback: Boolean): Boolean {
        return when (options) {
            is JSONObject -> if (options.has(key)) options.optBoolean(key, fallback) else fallback
            is Map<*, *> -> options[key] as? Boolean ?: fallback
            else -> fallback
        }
    }

    private fun getParams(args: Array<Any?>): Any? {
        return args.getOrNull(0)
    }

    private fun emitResult(cancelled: Boolean, assets: JSONArray) {
        val payload = JSONObject().apply {
            put("requestId", pendingRequestId)
            put("cancelled", cancelled)
            put("assets", assets)
        }
        runtime.emitEvent("DocumentPicker.result", payload)
        pendingRequestId = null
        pendingCopyToCacheDirectory = true
    }

    private fun errorResponse(error: String, message: String): JSONObject {
        return JSONObject().apply {
            put("error", error)
            put("message", message)
        }
    }
}
