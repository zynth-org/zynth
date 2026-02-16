package dev.zynth.documentpicker

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResultLauncher
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthArgs
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

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "pickDocumentAsync" -> pickDocumentAsync(args)
            else -> errorResponse("unsupported_method", method)
        }
    }

    private fun pickDocumentAsync(args: ZynthArgs): JSONObject {
        if (pendingRequestId != null) {
            return errorResponse("busy", "Another picker request is already active")
        }

        val requestId = args.getString("requestId", UUID.randomUUID().toString())
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

    private data class PickerOptions(
        val multiple: Boolean,
        val mimeTypes: List<String>,
        val copyToCacheDirectory: Boolean
    )

    private fun parseOptions(args: ZynthArgs): PickerOptions {
        val options = try { args.getMap("options") } catch (e: Exception) { null }

        val multiple = options?.get("multiple") as? Boolean ?: false
        val copyToCacheDirectory = options?.get("copyToCacheDirectory") as? Boolean ?: true
        val mimeTypes = getMimeTypes(options)
        return PickerOptions(
            multiple = multiple,
            mimeTypes = mimeTypes,
            copyToCacheDirectory = copyToCacheDirectory
        )
    }

    private fun getMimeTypes(options: Map<String, Any?>?): List<String> {
        val rawType = options?.get("type")

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
