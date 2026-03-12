package dev.zynth.medialibrary

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.FileInputStream

class MediaLibraryModule(
    private val activity: Activity,
) : ZynthModule {
    override val name: String = "MediaLibrary"

    override val exportedMethods: List<String> = listOf(
        "getPermissionsAsync",
        "requestPermissionsAsync",
        "saveImageAsync",
        "saveVideoAsync",
    )

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "getPermissionsAsync" -> permissionResponse()
            "requestPermissionsAsync" -> permissionResponse()
            "saveImageAsync" -> saveMedia(args, isVideo = false)
            "saveVideoAsync" -> saveMedia(args, isVideo = true)
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun permissionResponse(): JSONObject {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return JSONObject()
                .put("status", "granted")
                .put("granted", true)
                .put("canAskAgain", true)
        }

        val granted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.WRITE_EXTERNAL_STORAGE,
        ) == PackageManager.PERMISSION_GRANTED
        return JSONObject()
            .put("status", if (granted) "granted" else "denied")
            .put("granted", granted)
            .put("canAskAgain", true)
    }

    private fun saveMedia(args: ZynthArgs, isVideo: Boolean): JSONObject {
        val rawUri = args.getString("uri")
        val album = args.getString("album", "Zend")
        val sourceStream = openSourceStream(rawUri)

        val resolver = activity.contentResolver
        val collection = if (isVideo) {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }

        val displayName = deriveName(rawUri, if (isVideo) ".mp4" else ".jpg")
        val relativePath = if (isVideo) {
            "${Environment.DIRECTORY_MOVIES}/${sanitizeName(album)}"
        } else {
            "${Environment.DIRECTORY_PICTURES}/${sanitizeName(album)}"
        }

        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, guessMimeType(displayName, isVideo))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }

        val destinationUri = resolver.insert(collection, values)
            ?: throw IllegalStateException("Could not create media destination")

        try {
            resolver.openOutputStream(destinationUri, "w")?.use { out ->
                sourceStream.use { input ->
                    input.copyTo(out)
                }
            } ?: throw IllegalStateException("Could not open media destination stream")

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val finalizeValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.IS_PENDING, 0)
                }
                resolver.update(destinationUri, finalizeValues, null, null)
            }

            return JSONObject().put("uri", destinationUri.toString())
        } catch (error: Throwable) {
            resolver.delete(destinationUri, null, null)
            throw error
        }
    }

    private fun openSourceStream(rawUri: String): java.io.InputStream {
        val parsed = Uri.parse(rawUri.trim())
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

    private fun deriveName(rawUri: String, fallbackExt: String): String {
        val parsed = Uri.parse(rawUri)
        val path = parsed.path ?: rawUri
        val base = File(path).name.ifBlank { "received-media${fallbackExt}" }
        return sanitizeName(base)
    }

    private fun sanitizeName(value: String): String {
        val trimmed = value.trim().ifEmpty { "Zend" }
        return trimmed.replace(Regex("[^a-zA-Z0-9._-]"), "_").take(96)
    }

    private fun guessMimeType(name: String, isVideo: Boolean): String {
        val lower = name.lowercase()
        return if (isVideo) {
            when {
                lower.endsWith(".mov") -> "video/quicktime"
                lower.endsWith(".webm") -> "video/webm"
                lower.endsWith(".mkv") -> "video/x-matroska"
                else -> "video/mp4"
            }
        } else {
            when {
                lower.endsWith(".png") -> "image/png"
                lower.endsWith(".webp") -> "image/webp"
                lower.endsWith(".gif") -> "image/gif"
                lower.endsWith(".heic") -> "image/heic"
                else -> "image/jpeg"
            }
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
}
