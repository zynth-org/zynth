package dev.zynth.filesystem

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.util.Base64
import android.webkit.MimeTypeMap
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.attribute.BasicFileAttributes
import java.security.MessageDigest

class ZynthFileSystemModule(
    private val context: Context
) : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthFileSystem"

    override val exportedMethods: List<String> = listOf(
        "getPaths", "getDiskSpace", "getSharedContainers", "getPathInfo", "getInfo",
        "listDirectory", "createDirectory", "createFile", "delete", "copy", "move",
        "readText", "readBase64", "readBase64Chunk", "writeText", "writeBase64", "checksum"
    )

    override val protectedMethods: List<String> = listOf(
        "createDirectory", "createFile", "delete", "copy", "move", "writeText", "writeBase64"
    )

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "getPaths" -> resultResponse(getPaths())
            "getDiskSpace" -> resultResponse(getDiskSpace())
            "getSharedContainers" -> resultResponse(JSONObject())
            "getPathInfo" -> {
                val uri = args.getString("uri")
                resultResponse(getPathInfo(uri))
            }
            "getInfo" -> {
                val uri = args.getString("uri")
                val options = try { args.getMap("options") } catch (e: Exception) { null }
                resultResponse(getInfo(uri, options))
            }
            "listDirectory" -> {
                val uri = args.getString("uri")
                resultResponse(listDirectory(uri))
            }
            "createDirectory" -> {
                val uri = args.getString("uri")
                val options = try { args.getMap("options") } catch (e: Exception) { null }
                createDirectory(uri, options)
                successResponse()
            }
            "createFile" -> {
                val uri = args.getString("uri")
                val options = try { args.getMap("options") } catch (e: Exception) { null }
                createFile(uri, options)
                successResponse()
            }
            "delete" -> {
                val uri = args.getString("uri")
                val recursive = args.getBoolean("recursive", false)
                deleteItem(uri, recursive)
                successResponse()
            }
            "copy" -> {
                val from = args.getString("from")
                val to = args.getString("to")
                copyItem(from, to)
                successResponse()
            }
            "move" -> {
                val from = args.getString("from")
                val to = args.getString("to")
                moveItem(from, to)
                successResponse()
            }
            "readText" -> {
                val uri = args.getString("uri")
                resultResponse(readText(uri))
            }
            "readBase64" -> {
                val uri = args.getString("uri")
                resultResponse(readBase64(uri))
            }
            "readBase64Chunk" -> {
                val uri = args.getString("uri")
                val offset = args.getInt("offset")
                val length = args.getInt("length")
                resultResponse(readBase64Chunk(uri, offset, length))
            }
            "writeText" -> {
                val uri = args.getString("uri")
                val text = args.getString("text")
                writeText(uri, text)
                successResponse()
            }
            "writeBase64" -> {
                val uri = args.getString("uri")
                val data = args.getString("data")
                writeBase64(uri, data)
                successResponse()
            }
            "checksum" -> {
                val uri = args.getString("uri")
                val algorithm = args.getString("algorithm", "md5")
                resultResponse(computeChecksumForUri(uri, algorithm))
            }
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "getPaths" -> getPaths()
            "getDiskSpace" -> getDiskSpace()
            "getSharedContainers" -> JSONObject()
            "getPathInfo" -> {
                val uri = args.getString("uri")
                getPathInfo(uri)
            }
            "getInfo" -> {
                val uri = args.getString("uri")
                val options = try { args.getMap("options") } catch (e: Exception) { null }
                getInfo(uri, options)
            }
            "listDirectory" -> {
                val uri = args.getString("uri")
                listDirectory(uri)
            }
            "createDirectory" -> {
                val uri = args.getString("uri")
                val options = try { args.getMap("options") } catch (e: Exception) { null }
                createDirectory(uri, options)
                null
            }
            "createFile" -> {
                val uri = args.getString("uri")
                val options = try { args.getMap("options") } catch (e: Exception) { null }
                createFile(uri, options)
                null
            }
            "delete" -> {
                val uri = args.getString("uri")
                val recursive = args.getBoolean("recursive", false)
                deleteItem(uri, recursive)
                null
            }
            "copy" -> {
                val from = args.getString("from")
                val to = args.getString("to")
                copyItem(from, to)
                null
            }
            "move" -> {
                val from = args.getString("from")
                val to = args.getString("to")
                moveItem(from, to)
                null
            }
            "readText" -> {
                val uri = args.getString("uri")
                readText(uri)
            }
            "readBase64" -> {
                val uri = args.getString("uri")
                readBase64(uri)
            }
            "readBase64Chunk" -> {
                val uri = args.getString("uri")
                val offset = args.getInt("offset")
                val length = args.getInt("length")
                readBase64Chunk(uri, offset, length)
            }
            "writeText" -> {
                val uri = args.getString("uri")
                val text = args.getString("text")
                writeText(uri, text)
                null
            }
            "writeBase64" -> {
                val uri = args.getString("uri")
                val data = args.getString("data")
                writeBase64(uri, data)
                null
            }
            "checksum" -> {
                val uri = args.getString("uri")
                val algorithm = args.getString("algorithm", "md5")
                computeChecksumForUri(uri, algorithm)
            }
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun getPaths(): JSONObject {
        val document = fileUri(context.filesDir)
        val cache = fileUri(context.cacheDir)
        val bundle = "asset://"
        return JSONObject().apply {
            put("document", document)
            put("cache", cache)
            put("bundle", bundle)
        }
    }

    private fun getDiskSpace(): JSONObject {
        val stat = StatFs(context.filesDir.absolutePath)
        val total = stat.totalBytes
        val available = stat.availableBytes
        return JSONObject().apply {
            put("total", total)
            put("available", available)
        }
    }

    private fun getPathInfo(uri: String): JSONObject {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            val assetInfo = getAssetInfo(parsed.path)
            return JSONObject().apply {
                put("exists", assetInfo.exists)
                put("isDirectory", if (assetInfo.exists) assetInfo.isDirectory else JSONObject.NULL)
            }
        }
        val file = File(parsed.path)
        val exists = file.exists()
        return JSONObject().apply {
            put("exists", exists)
            put("isDirectory", if (exists) file.isDirectory else JSONObject.NULL)
        }
    }

    private fun getInfo(uri: String, options: Map<String, Any?>?): JSONObject {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            val assetInfo = getAssetInfo(parsed.path)
            return JSONObject().apply {
                put("uri", uri)
                put("exists", assetInfo.exists)
                put("size", if (assetInfo.exists && !assetInfo.isDirectory) assetInfo.size else JSONObject.NULL)
                put("creationTime", JSONObject.NULL)
                put("modificationTime", JSONObject.NULL)
                put("type", if (assetInfo.exists && !assetInfo.isDirectory) mimeType(parsed.path) else "")
                put("md5", JSONObject.NULL)
            }
        }

        val file = File(parsed.path)
        val exists = file.exists()
        val isDirectory = file.isDirectory
        val creationTime = if (exists && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getCreationTime(file)
        } else {
            null
        }
        val modificationTime = if (exists) file.lastModified() else null

        val md5Requested = options?.get("md5") as? Boolean ?: false
        val md5 = if (md5Requested && exists && !isDirectory) {
            computeDigest(file, "MD5")
        } else {
            null
        }

        return JSONObject().apply {
            put("uri", uri)
            put("exists", exists)
            put("size", if (exists && !isDirectory) file.length() else JSONObject.NULL)
            put("creationTime", creationTime ?: JSONObject.NULL)
            put("modificationTime", modificationTime ?: JSONObject.NULL)
            put("type", if (exists && !isDirectory) mimeType(file.name) else "")
            put("md5", md5 ?: JSONObject.NULL)
        }
    }

    private fun listDirectory(uri: String): JSONArray {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            return listAssetDirectory(parsed.path)
        }
        val file = File(parsed.path)
        if (!file.exists() || !file.isDirectory) {
            throw IllegalArgumentException("Directory not found")
        }
        val result = JSONArray()
        file.listFiles()?.forEach { entry ->
            val item = JSONObject().apply {
                put("name", entry.name)
                put("uri", fileUri(entry))
                put("isDirectory", entry.isDirectory)
            }
            result.put(item)
        }
        return result
    }

    private fun createDirectory(uri: String, options: Map<String, Any?>?) {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            throw IllegalArgumentException("Cannot create directories in assets")
        }
        val file = File(parsed.path)
        val intermediates = options?.get("intermediates") as? Boolean ?: false
        val overwrite = options?.get("overwrite") as? Boolean ?: false
        val idempotent = options?.get("idempotent") as? Boolean ?: false

        if (file.exists()) {
            if (overwrite) {
                deleteRecursively(file)
            } else if (idempotent) {
                return
            } else {
                throw IllegalStateException("Destination already exists")
            }
        }

        if (intermediates) {
            if (!file.mkdirs()) {
                throw IllegalStateException("Unable to create directory")
            }
        } else if (!file.mkdir()) {
            throw IllegalStateException("Unable to create directory")
        }
    }

    private fun createFile(uri: String, options: Map<String, Any?>?) {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            throw IllegalArgumentException("Cannot create files in assets")
        }
        val file = File(parsed.path)
        val intermediates = options?.get("intermediates") as? Boolean ?: false
        val overwrite = options?.get("overwrite") as? Boolean ?: false

        if (file.exists()) {
            if (overwrite) {
                file.delete()
            } else {
                return
            }
        }

        if (intermediates) {
            file.parentFile?.mkdirs()
        }
        file.createNewFile()
    }

    private fun deleteItem(uri: String, recursive: Boolean) {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            throw IllegalArgumentException("Cannot delete assets")
        }
        val file = File(parsed.path)
        if (!file.exists()) return
        if (file.isDirectory && !recursive && file.listFiles()?.isNotEmpty() == true) {
            throw IllegalStateException("Directory not empty")
        }
        deleteRecursively(file)
    }

    private fun copyItem(from: String, to: String) {
        val fromParsed = parseUri(from)
        val toParsed = parseUri(to)
        if (fromParsed.scheme == "asset" || toParsed.scheme == "asset") {
            throw IllegalArgumentException("Copying assets is not supported")
        }
        val source = File(fromParsed.path)
        val destination = File(toParsed.path)
        if (destination.exists()) {
            throw IllegalStateException("Destination already exists")
        }
        destination.parentFile?.mkdirs()
        if (source.isDirectory) {
            copyDirectory(source, destination)
        } else {
            copyFile(source, destination)
        }
    }

    private fun moveItem(from: String, to: String) {
        val fromParsed = parseUri(from)
        val toParsed = parseUri(to)
        if (fromParsed.scheme == "asset" || toParsed.scheme == "asset") {
            throw IllegalArgumentException("Moving assets is not supported")
        }
        val source = File(fromParsed.path)
        val destination = File(toParsed.path)
        if (destination.exists()) {
            throw IllegalStateException("Destination already exists")
        }
        destination.parentFile?.mkdirs()
        val moved = source.renameTo(destination)
        if (!moved) {
            if (source.isDirectory) {
                copyDirectory(source, destination)
                deleteRecursively(source)
            } else {
                copyFile(source, destination)
                source.delete()
            }
        }
    }

    private fun readText(uri: String): String {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            return readAssetText(parsed.path)
        }
        return File(parsed.path).readText()
    }

    private fun readBase64(uri: String): String {
        val parsed = parseUri(uri)
        val bytes = if (parsed.scheme == "asset") {
            readAssetBytes(parsed.path)
        } else {
            FileInputStream(parsed.path).use { it.readBytes() }
        }
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun readBase64Chunk(uri: String, offset: Int, length: Int): String {
        if (offset < 0 || length <= 0) {
            throw IllegalArgumentException("Invalid offset/length")
        }

        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            context.assets.open(parsed.path).use { stream ->
                if (!skipFully(stream, offset.toLong())) {
                    return ""
                }
                val buffer = ByteArray(length)
                val read = stream.read(buffer)
                if (read <= 0) {
                    return ""
                }
                return Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP)
            }
        }

        FileInputStream(parsed.path).use { stream ->
            stream.channel.position(offset.toLong())
            val buffer = ByteArray(length)
            val read = stream.read(buffer)
            if (read <= 0) {
                return ""
            }
            return Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP)
        }
    }

    private fun writeText(uri: String, text: String) {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            throw IllegalArgumentException("Cannot write to assets")
        }
        val file = File(parsed.path)
        file.parentFile?.mkdirs()
        file.writeText(text)
    }

    private fun writeBase64(uri: String, base64: String) {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            throw IllegalArgumentException("Cannot write to assets")
        }
        val file = File(parsed.path)
        file.parentFile?.mkdirs()
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        FileOutputStream(file).use { it.write(bytes) }
    }

    private fun fileUri(file: File): String {
        return "file://${file.absolutePath}"
    }

    private data class ParsedUri(val scheme: String?, val path: String)

    private fun parseUri(uri: String): ParsedUri {
        val parsed = Uri.parse(uri)
        val scheme = parsed.scheme
        if (scheme == null) {
            return ParsedUri(null, uri)
        }
        return when (scheme) {
            "file" -> ParsedUri("file", parsed.path ?: "")
            "asset", "bundle" -> ParsedUri("asset", parsed.path?.trimStart('/') ?: "")
            else -> ParsedUri(scheme, parsed.path ?: uri)
        }
    }

    private data class AssetInfo(val exists: Boolean, val isDirectory: Boolean, val size: Long?)

    private fun getAssetInfo(path: String): AssetInfo {
        return try {
            val list = context.assets.list(path)
            if (list != null && list.isNotEmpty()) {
                AssetInfo(true, true, null)
            } else {
                val descriptor = try {
                    context.assets.openFd(path)
                } catch (_: Exception) {
                    null
                }
                val size = descriptor?.length
                AssetInfo(true, false, size)
            }
        } catch (_: Exception) {
            AssetInfo(false, false, null)
        }
    }

    private fun listAssetDirectory(path: String): JSONArray {
        val result = JSONArray()
        val list = context.assets.list(path) ?: return result
        for (name in list) {
            val childPath = if (path.isEmpty()) name else "$path/$name"
            val info = getAssetInfo(childPath)
            val uri = if (path.isEmpty()) {
                "asset://$name"
            } else {
                "asset://$path/$name"
            }
            val item = JSONObject().apply {
                put("name", name)
                put("uri", uri)
                put("isDirectory", info.isDirectory)
            }
            result.put(item)
        }
        return result
    }

    private fun readAssetText(path: String): String {
        return context.assets.open(path).bufferedReader().use { it.readText() }
    }

    private fun readAssetBytes(path: String): ByteArray {
        return context.assets.open(path).use { it.readBytes() }
    }

    private fun skipFully(stream: java.io.InputStream, bytesToSkip: Long): Boolean {
        var remaining = bytesToSkip
        val scratch = ByteArray(4096)
        while (remaining > 0) {
            val skipped = stream.skip(remaining)
            if (skipped > 0) {
                remaining -= skipped
                continue
            }
            val read = stream.read(scratch, 0, minOf(remaining, scratch.size.toLong()).toInt())
            if (read <= 0) {
                return false
            }
            remaining -= read.toLong()
        }
        return true
    }

    private fun copyFile(source: File, destination: File) {
        FileInputStream(source).use { input ->
            FileOutputStream(destination).use { output ->
                input.copyTo(output)
            }
        }
    }

    private fun copyDirectory(source: File, destination: File) {
        if (!destination.exists()) {
            destination.mkdirs()
        }
        source.listFiles()?.forEach { entry ->
            val target = File(destination, entry.name)
            if (entry.isDirectory) {
                copyDirectory(entry, target)
            } else {
                copyFile(entry, target)
            }
        }
    }

    private fun deleteRecursively(file: File) {
        if (file.isDirectory) {
            file.listFiles()?.forEach { child -> deleteRecursively(child) }
        }
        file.delete()
    }

    private fun mimeType(name: String): String {
        val extension = name.substringAfterLast('.', "")
        if (extension.isEmpty()) return ""
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.lowercase()) ?: ""
    }

    private fun getCreationTime(file: File): Long? {
        return try {
            val attributes = Files.readAttributes(file.toPath(), BasicFileAttributes::class.java)
            attributes.creationTime().toMillis()
        } catch (_: Exception) {
            null
        }
    }

    private fun computeDigest(file: File, algorithm: String): String? {
        return try {
            val digest = MessageDigest.getInstance(algorithm)
            FileInputStream(file).use { stream ->
                val buffer = ByteArray(8192)
                var read = stream.read(buffer)
                while (read > 0) {
                    digest.update(buffer, 0, read)
                    read = stream.read(buffer)
                }
            }
            digest.digest().joinToString("") { byte -> "%02x".format(byte) }
        } catch (_: Exception) {
            null
        }
    }

    private fun computeChecksumForUri(uri: String, algorithm: String): String {
        val parsed = parseUri(uri)
        val digestName = when (algorithm.lowercase()) {
            "md5" -> "MD5"
            "sha1" -> "SHA-1"
            "sha256" -> "SHA-256"
            else -> throw IllegalArgumentException("Unsupported algorithm: $algorithm")
        }

        if (parsed.scheme == "asset") {
            val digest = MessageDigest.getInstance(digestName)
            context.assets.open(parsed.path).use { stream ->
                val buffer = ByteArray(8192)
                var read = stream.read(buffer)
                while (read > 0) {
                    digest.update(buffer, 0, read)
                    read = stream.read(buffer)
                }
            }
            return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
        }

        val file = File(parsed.path)
        return computeDigest(file, digestName)
            ?: throw IllegalStateException("Unable to compute checksum")
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
}
