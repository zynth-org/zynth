package dev.zynth.filesystem

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.util.Base64
import android.webkit.MimeTypeMap
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
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

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return try {
            when (method) {
                "getPaths" -> resultResponse(getPaths())
                "getDiskSpace" -> resultResponse(getDiskSpace())
                "getSharedContainers" -> resultResponse(JSONObject())
                "getPathInfo" -> {
                    val uri = getStringArg(args, "uri")
                    if (uri == null) {
                        errorResponse("invalid_argument", "uri")
                    } else {
                        resultResponse(getPathInfo(uri))
                    }
                }
                "getInfo" -> {
                    val uri = getStringArg(args, "uri")
                    if (uri == null) {
                        errorResponse("invalid_argument", "uri")
                    } else {
                        resultResponse(getInfo(uri, getOptionsArg(args)))
                    }
                }
                "listDirectory" -> {
                    val uri = getStringArg(args, "uri")
                    if (uri == null) {
                        errorResponse("invalid_argument", "uri")
                    } else {
                        resultResponse(listDirectory(uri))
                    }
                }
                "createDirectory" -> {
                    val uri = getStringArg(args, "uri")
                    if (uri == null) {
                        errorResponse("invalid_argument", "uri")
                    } else {
                        createDirectory(uri, getOptionsArg(args))
                        successResponse()
                    }
                }
                "createFile" -> {
                    val uri = getStringArg(args, "uri")
                    if (uri == null) {
                        errorResponse("invalid_argument", "uri")
                    } else {
                        createFile(uri, getOptionsArg(args))
                        successResponse()
                    }
                }
                "delete" -> {
                    val uri = getStringArg(args, "uri")
                    if (uri == null) {
                        errorResponse("invalid_argument", "uri")
                    } else {
                        val recursive = getBoolArg(args, "recursive") ?: false
                        deleteItem(uri, recursive)
                        successResponse()
                    }
                }
                "copy" -> {
                    val from = getStringArg(args, "from")
                    val to = getStringArg(args, "to")
                    if (from == null || to == null) {
                        errorResponse("invalid_argument", "from/to")
                    } else {
                        copyItem(from, to)
                        successResponse()
                    }
                }
                "move" -> {
                    val from = getStringArg(args, "from")
                    val to = getStringArg(args, "to")
                    if (from == null || to == null) {
                        errorResponse("invalid_argument", "from/to")
                    } else {
                        moveItem(from, to)
                        successResponse()
                    }
                }
                "readText" -> {
                    val uri = getStringArg(args, "uri")
                    if (uri == null) {
                        errorResponse("invalid_argument", "uri")
                    } else {
                        resultResponse(readText(uri))
                    }
                }
                "readBase64" -> {
                    val uri = getStringArg(args, "uri")
                    if (uri == null) {
                        errorResponse("invalid_argument", "uri")
                    } else {
                        resultResponse(readBase64(uri))
                    }
                }
                "writeText" -> {
                    val uri = getStringArg(args, "uri")
                    val text = getStringArg(args, "text")
                    if (uri == null || text == null) {
                        errorResponse("invalid_argument", "uri/text")
                    } else {
                        writeText(uri, text)
                        successResponse()
                    }
                }
                "writeBase64" -> {
                    val uri = getStringArg(args, "uri")
                    val data = getStringArg(args, "data")
                    if (uri == null || data == null) {
                        errorResponse("invalid_argument", "uri/data")
                    } else {
                        writeBase64(uri, data)
                        successResponse()
                    }
                }
                else -> errorResponse("unsupported_method", method)
            }
        } catch (e: Exception) {
            errorResponse("io_error", e.message ?: "Unknown error")
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return try {
            when (method) {
                "getPaths" -> getPaths()
                "getDiskSpace" -> getDiskSpace()
                "getSharedContainers" -> JSONObject()
                "getPathInfo" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    getPathInfo(uri)
                }
                "getInfo" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    getInfo(uri, getOptionsArg(args))
                }
                "listDirectory" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    listDirectory(uri)
                }
                "createDirectory" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    createDirectory(uri, getOptionsArg(args))
                    null
                }
                "createFile" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    createFile(uri, getOptionsArg(args))
                    null
                }
                "delete" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    val recursive = getBoolArg(args, "recursive") ?: false
                    deleteItem(uri, recursive)
                    null
                }
                "copy" -> {
                    val from = getStringArg(args, "from") ?: return null
                    val to = getStringArg(args, "to") ?: return null
                    copyItem(from, to)
                    null
                }
                "move" -> {
                    val from = getStringArg(args, "from") ?: return null
                    val to = getStringArg(args, "to") ?: return null
                    moveItem(from, to)
                    null
                }
                "readText" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    readText(uri)
                }
                "readBase64" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    readBase64(uri)
                }
                "writeText" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    val text = getStringArg(args, "text") ?: return null
                    writeText(uri, text)
                    null
                }
                "writeBase64" -> {
                    val uri = getStringArg(args, "uri") ?: return null
                    val data = getStringArg(args, "data") ?: return null
                    writeBase64(uri, data)
                    null
                }
                else -> null
            }
        } catch (e: Exception) {
            errorResponse("io_error", e.message ?: "Unknown error")
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

    private fun getInfo(uri: String, options: Any?): JSONObject {
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

        val md5Requested = getBooleanOption(options, "md5")
        val md5 = if (md5Requested && exists && !isDirectory) {
            computeMd5(file)
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

    private fun createDirectory(uri: String, options: Any?) {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            throw IllegalArgumentException("Cannot create directories in assets")
        }
        val file = File(parsed.path)
        val intermediates = getBooleanOption(options, "intermediates")
        val overwrite = getBooleanOption(options, "overwrite")
        val idempotent = getBooleanOption(options, "idempotent")

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

    private fun createFile(uri: String, options: Any?) {
        val parsed = parseUri(uri)
        if (parsed.scheme == "asset") {
            throw IllegalArgumentException("Cannot create files in assets")
        }
        val file = File(parsed.path)
        val intermediates = getBooleanOption(options, "intermediates")
        val overwrite = getBooleanOption(options, "overwrite")

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

    private fun computeMd5(file: File): String? {
        return try {
            val digest = MessageDigest.getInstance("MD5")
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

    private fun getParams(args: Array<Any?>): Any? {
        return args.getOrNull(0)
    }

    private fun getValue(args: Array<Any?>, key: String): Any? {
        val params = getParams(args)
        return when (params) {
            is JSONObject -> params.opt(key)
            is Map<*, *> -> params[key]
            else -> null
        }
    }

    private fun getOptionsArg(args: Array<Any?>): Any? {
        return getValue(args, "options")
    }

    private fun getBooleanOption(options: Any?, key: String): Boolean {
        return when (options) {
            is JSONObject -> options.optBoolean(key, false)
            is Map<*, *> -> options[key] as? Boolean ?: false
            else -> false
        }
    }

    private fun getStringArg(args: Array<Any?>, key: String): String? {
        val value = getValue(args, key)
        return if (value == JSONObject.NULL) null else value as? String
    }

    private fun getBoolArg(args: Array<Any?>, key: String): Boolean? {
        val value = getValue(args, key)
        return if (value == JSONObject.NULL) null else value as? Boolean
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
