package dev.zynth.fileintents

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.FileInputStream
import java.util.Locale

class FileIntentsModule(
    private val runtime: ZynthRuntime,
    private val activity: Activity,
) : ZynthModule {
    override val name: String = "FileIntents"

    override val exportedMethods: List<String> = listOf(
        "openAsync",
        "shareAsync",
        "exportAsync",
    )

    var exportLauncher: ActivityResultLauncher<Intent>? = null

    private data class PendingExport(
        val requestId: String,
        val sourceUri: String,
        val mimeType: String,
    )

    private data class ShareFileEntry(
        val uri: Uri,
        val mimeType: String?,
    )

    private var pendingExport: PendingExport? = null

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "openAsync" -> openAsync(args)
            "shareAsync" -> shareAsync(args)
            "exportAsync" -> exportAsync(args)
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun openAsync(args: ZynthArgs): JSONObject {
        val uri = args.getString("uri")
        val mimeType = normalizeMimeType(args.getOptionalString("mimeType"))
        val intent = Intent(Intent.ACTION_VIEW).apply {
            val contentUri = toExternalUri(uri)
            setDataAndType(contentUri, mimeType)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        try {
            val chooser = Intent.createChooser(intent, "Open file")
            activity.startActivity(chooser)
        } catch (error: ActivityNotFoundException) {
            throw IllegalStateException("No compatible app found to open this file")
        }
        return JSONObject().put("opened", true)
    }

    private fun shareAsync(args: ZynthArgs): JSONObject {
        val payload = try { args.asMap() } catch (_: Exception) { emptyMap() }
        val files = normalizeFileUris(payload["files"])
        val text = payload["text"] as? String
        val subject = payload["subject"] as? String

        if (files.isEmpty() && text.isNullOrBlank()) {
            throw IllegalArgumentException("shareAsync requires at least one file or text")
        }

        val dominantMimeType = selectShareMimeType(files)
        val intent = if (files.size > 1) {
            Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = dominantMimeType
                putParcelableArrayListExtra(
                    Intent.EXTRA_STREAM,
                    ArrayList(files.map { it.uri }),
                )
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        } else {
            Intent(Intent.ACTION_SEND).apply {
                type = dominantMimeType
                files.firstOrNull()?.let { putExtra(Intent.EXTRA_STREAM, it.uri) }
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }

        if (!text.isNullOrBlank()) {
            intent.putExtra(Intent.EXTRA_TEXT, text)
        }
        if (!subject.isNullOrBlank()) {
            intent.putExtra(Intent.EXTRA_SUBJECT, subject)
        }

        try {
            val chooser = Intent.createChooser(intent, "Share")
            activity.startActivity(chooser)
        } catch (error: ActivityNotFoundException) {
            throw IllegalStateException("No compatible app found to share this content")
        }
        return JSONObject().put("shared", true)
    }

    private fun exportAsync(args: ZynthArgs): JSONObject {
        if (pendingExport != null) {
            throw IllegalStateException("Another export request is already active")
        }

        val requestId = args.getString("requestId")
        val uri = args.getString("uri")
        val mimeType = normalizeMimeType(args.getOptionalString("mimeType"))
        val target = args.getString("target", "downloads").lowercase(Locale.US)
        if (target != "downloads" && target != "files") {
            throw IllegalArgumentException("Android export target must be 'downloads' or 'files'")
        }
        val suggestedName = sanitizeFileName(args.getString("suggestedName", deriveName(uri)))

        pendingExport = PendingExport(
            requestId = requestId,
            sourceUri = uri,
            mimeType = mimeType,
        )

        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
            putExtra(Intent.EXTRA_TITLE, suggestedName)
        }

        val launcher = exportLauncher ?: throw IllegalStateException("Export launcher not initialized")
        launcher.launch(intent)
        return JSONObject().put("status", "pending")
    }

    fun onExportResult(result: ActivityResult) {
        val pending = pendingExport ?: return
        pendingExport = null

        if (result.resultCode != Activity.RESULT_OK) {
            emitExportResult(pending.requestId, cancelled = true, destinationUri = null, error = null)
            return
        }

        val destinationUri = result.data?.data
        if (destinationUri == null) {
            emitExportResult(pending.requestId, cancelled = true, destinationUri = null, error = null)
            return
        }

        try {
            val output = activity.contentResolver.openOutputStream(destinationUri, "w")
                ?: throw IllegalStateException("Could not open destination stream")
            output.use { sink ->
                openSourceStream(pending.sourceUri).use { source ->
                    source.copyTo(sink)
                }
            }

            emitExportResult(
                pending.requestId,
                cancelled = false,
                destinationUri = destinationUri.toString(),
                error = null,
            )
        } catch (error: Throwable) {
            emitExportResult(
                pending.requestId,
                cancelled = false,
                destinationUri = null,
                error = error.message ?: "Export failed",
            )
        }
    }

    private fun emitExportResult(
        requestId: String,
        cancelled: Boolean,
        destinationUri: String?,
        error: String?,
    ) {
        val payload = JSONObject().apply {
            put("requestId", requestId)
            put("cancelled", cancelled)
            put("destinationUri", destinationUri ?: JSONObject.NULL)
            put("error", error ?: JSONObject.NULL)
        }
        runtime.emitEvent("FileIntents.result", payload)
    }

    private fun normalizeFileUris(rawFiles: Any?): List<ShareFileEntry> {
        val typed = mutableListOf<ShareFileEntry>()
        val list = when (rawFiles) {
            is JSONArray -> (0 until rawFiles.length()).mapNotNull { rawFiles.opt(it) }
            is List<*> -> rawFiles
            else -> emptyList<Any?>()
        }

        for (entry in list) {
            val map = entry as? Map<*, *> ?: continue
            val rawUri = map["uri"] as? String ?: continue
            val mimeType = normalizeMimeType(map["mimeType"] as? String)
            val uri = toExternalUri(rawUri)
            typed.add(ShareFileEntry(uri = uri, mimeType = mimeType))
        }

        return typed
    }

    private fun toExternalUri(rawUri: String): Uri {
        val parsed = Uri.parse(rawUri.trim())
        val scheme = parsed.scheme?.lowercase()
        if (scheme == "content") {
            return parsed
        }

        val file = if (scheme == "file" || scheme == null) {
            val candidate = if (scheme == "file") {
                File(parsed.path ?: throw IllegalArgumentException("Invalid file URI"))
            } else {
                File(rawUri)
            }
            assertReadableSandboxFile(candidate)
        } else {
            throw IllegalArgumentException("Unsupported URI scheme '$scheme'. Only file/content URIs are allowed.")
        }

        val authority = "${activity.packageName}.zynth.fileintents.provider"
        return FileProvider.getUriForFile(activity, authority, file)
    }

    private fun openSourceStream(rawUri: String): java.io.InputStream {
        val parsed = Uri.parse(rawUri)
        val scheme = parsed.scheme?.lowercase()

        return when (scheme) {
            "content" -> activity.contentResolver.openInputStream(parsed)
                ?: throw IllegalStateException("Could not open content source")
            "file" -> {
                val file = assertReadableSandboxFile(
                    File(parsed.path ?: throw IllegalStateException("Invalid file URI")),
                )
                FileInputStream(file)
            }
            null -> {
                val file = assertReadableSandboxFile(File(rawUri))
                FileInputStream(file)
            }
            else -> throw IllegalArgumentException("Unsupported URI scheme '$scheme'. Only file/content URIs are allowed.")
        }
    }

    private fun deriveName(rawUri: String): String {
        val parsed = Uri.parse(rawUri)
        val scheme = parsed.scheme?.lowercase()

        if (scheme == "content") {
            activity.contentResolver.query(parsed, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0) {
                            val name = cursor.getString(idx)
                            if (!name.isNullOrBlank()) return name
                        }
                    }
                }
        }

        val path = parsed.path ?: rawUri
        return File(path).name.ifBlank { "exported-file" }
    }

    private fun sanitizeFileName(value: String): String {
        val trimmed = value.trim().ifEmpty { "exported-file" }
        return trimmed.replace(Regex("[^a-zA-Z0-9._-]"), "_")
    }

    private fun normalizeMimeType(value: String?): String {
        val raw = value?.trim().orEmpty()
        if (raw.isEmpty()) return "*/*"
        return if (Regex("^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+*-]+$").matches(raw)) {
            raw.lowercase(Locale.US)
        } else {
            throw IllegalArgumentException("Invalid mimeType '$raw'")
        }
    }

    private fun assertReadableSandboxFile(file: File): File {
        val canonical = file.canonicalFile
        val allowedRoots = buildList {
            activity.filesDir?.let { add(it.canonicalFile) }
            activity.cacheDir?.let { add(it.canonicalFile) }
            activity.externalCacheDir?.let { add(it.canonicalFile) }
            activity.getExternalFilesDir(null)?.let { add(it.canonicalFile) }
        }
        val allowed = allowedRoots.any { root ->
            canonical.path == root.path || canonical.path.startsWith("${root.path}${File.separator}")
        }
        if (!allowed) {
            throw SecurityException("File path is outside app sandbox: ${canonical.path}")
        }
        if (!canonical.exists() || !canonical.isFile) {
            throw FileNotFoundException("File does not exist: ${canonical.path}")
        }
        if (!canonical.canRead()) {
            throw SecurityException("File is not readable: ${canonical.path}")
        }
        return canonical
    }

    private fun selectShareMimeType(files: List<ShareFileEntry>): String {
        if (files.isEmpty()) return "text/plain"
        val unique = files.map { it.mimeType ?: "*/*" }.distinct()
        return if (unique.size == 1) unique.first() else "*/*"
    }
}
