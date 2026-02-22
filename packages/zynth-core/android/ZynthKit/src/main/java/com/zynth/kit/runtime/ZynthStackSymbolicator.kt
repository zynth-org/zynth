package com.zynth.kit.runtime

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

internal object ZynthStackSymbolicator {
  private const val TAG = "ZynthSymbolicator"
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "ZynthStackSymbolicator").apply { isDaemon = true }
  }
  private val mainHandler = Handler(Looper.getMainLooper())
  private val mapCache = ConcurrentHashMap<String, SourceMapIndex?>()

  private data class StackFrame(
    val file: String,
    val method: String,
    val lineNumber: Int,
    val column: Int?,
  )

  private data class ParsedLocation(
    val file: String,
    val lineNumber: Int?,
    val column: Int?,
  )

  private data class OriginalPosition(
    val source: String?,
    val line: Int?,
    val column: Int?,
    val name: String?,
  )

  private data class Segment(
    val generatedColumn: Int,
    val sourceIndex: Int?,
    val originalLine: Int?,
    val originalColumn: Int?,
    val nameIndex: Int?,
  )

  private data class SourceMapIndex(
    val sources: List<String>,
    val names: List<String>,
    val sourceRoot: String?,
    val lines: List<List<Segment>>,
  )

  fun symbolicateStackTrace(stack: String, callback: (String) -> Unit) {
    executor.execute {
      val symbolicated = runCatching { symbolicateSync(stack) }.getOrElse { stack }
      mainHandler.post { callback(symbolicated) }
    }
  }

  private fun symbolicateSync(stack: String): String {
    val frames = parseStack(stack)
    if (frames.isEmpty()) {
      Log.d(TAG, "no frames parsed")
      return stack
    }
    Log.d(TAG, "parsed ${frames.size} frames")
    val symbolicated = ArrayList<String>(frames.size)

    for (frame in frames) {
      val bundleUrl = normalizedBundleUrl(frame.file)
      if (bundleUrl == null) {
        Log.d(TAG, "skipping non-symbolic frame: ${frame.file}")
        symbolicated += formatFrame(frame.method, frame.file, frame.lineNumber, frame.column)
        continue
      }

      val index = fetchMapIndex(bundleUrl)
      if (index == null) {
        Log.d(TAG, "no sourcemap for $bundleUrl")
        symbolicated += formatFrame(frame.method, frame.file, frame.lineNumber, frame.column)
        continue
      }

      var original = resolveOriginalPosition(index, frame)
      if (original.source == null) {
        original = findClosestMapping(index, frame)
      }

      if (original.source != null) {
        val method = original.name ?: frame.method
        Log.d(TAG, "symbolicated ${frame.file}:${frame.lineNumber}")
        symbolicated += formatFrame(method, original.source, original.line, original.column)
      } else {
        Log.d(TAG, "mapping not found for ${frame.file}:${frame.lineNumber}")
        symbolicated += formatFrame(frame.method, frame.file, frame.lineNumber, frame.column)
      }
    }

    return symbolicated.joinToString("\n")
  }

  private fun parseStack(stack: String): List<StackFrame> {
    val lines = stack.split('\n')
    val frames = mutableListOf<StackFrame>()
    for (line in lines) {
      val trimmed = line.trim()
      if (!trimmed.startsWith("at ")) continue
      val body = trimmed.removePrefix("at ").trim()
      if (body.isEmpty()) continue

      var method = "<unknown>"
      var location = body

      val parenStart = body.indexOf(" (")
      if (parenStart != -1 && body.endsWith(")")) {
        method = body.substring(0, parenStart).trim().ifBlank { "<unknown>" }
        location = body.substring(parenStart + 2, body.length - 1).trim()
      }

      val parsed = parseLocation(location)
      if (parsed.lineNumber == null) continue
      frames += StackFrame(
        file = parsed.file,
        method = method,
        lineNumber = parsed.lineNumber,
        column = parsed.column,
      )
    }
    return frames
  }

  private fun parseLocation(location: String): ParsedLocation {
    var loc = location.trim()
    if (loc.endsWith(")")) {
      loc = loc.substring(0, loc.length - 1)
    }
    val match = Regex(":(\\d+)(?::(\\d+))?$").find(loc)
      ?: return ParsedLocation(file = loc, lineNumber = null, column = null)
    val lineNumber = match.groupValues.getOrNull(1)?.toIntOrNull()
    val column = match.groupValues.getOrNull(2)?.toIntOrNull()
    val file = loc.substring(0, match.range.first)
    return ParsedLocation(file = file, lineNumber = lineNumber, column = column)
  }

  private fun fetchMapIndex(bundleUrl: String): SourceMapIndex? {
    val mapUrl = mapUrlFor(bundleUrl) ?: return null
    if (mapCache.containsKey(mapUrl)) {
      return mapCache[mapUrl]
    }
    val loaded = runCatching {
      val mapJson = fetchMapJson(mapUrl) ?: return@runCatching null
      parseSourceMap(mapJson)
    }.getOrNull()
    if (loaded == null) {
      Log.d(TAG, "sourcemap parse failed $mapUrl")
    }
    mapCache[mapUrl] = loaded
    return loaded
  }

  private fun normalizedBundleUrl(file: String): String? {
    if (file.startsWith("http://") || file.startsWith("https://")) {
      return file
    }
    val baseUrl = System.getProperty("ZYNTH_DEV_SERVER_URL")?.trim().orEmpty()
    if (baseUrl.isEmpty()) {
      return null
    }
    val cleaned = file.trim().trimStart('/')
    if (cleaned.isEmpty()) {
      return null
    }
    return runCatching { URL(URL(baseUrl), cleaned).toString() }.getOrNull()
  }

  private fun mapUrlFor(bundleUrl: String): String? {
    return try {
      val uri = URI(bundleUrl)
      val path = uri.path ?: return null
      URI(
        uri.scheme,
        uri.userInfo,
        uri.host,
        uri.port,
        "$path.map",
        uri.query,
        uri.fragment,
      ).toString()
    } catch (_: Throwable) {
      null
    }
  }

  private fun fetchMapJson(mapUrl: String): String? {
    val connection = (URI(mapUrl).toURL().openConnection() as? HttpURLConnection) ?: return null
    return try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 1500
      connection.readTimeout = 2000
      connection.setRequestProperty("Accept", "application/json")
      val status = connection.responseCode
      if (status !in 200..299) {
        Log.d(TAG, "sourcemap fetch failed ($status) $mapUrl")
        return null
      }
      Log.d(TAG, "sourcemap fetched $mapUrl")
      BufferedReader(InputStreamReader(connection.inputStream)).use { reader ->
        buildString {
          var line: String? = reader.readLine()
          while (line != null) {
            append(line)
            line = reader.readLine()
          }
        }
      }
    } catch (_: Throwable) {
      null
    } finally {
      connection.disconnect()
    }
  }

  private fun parseSourceMap(json: String): SourceMapIndex? {
    val root = runCatching { JSONObject(json) }.getOrNull() ?: return null
    val mappings = root.optString("mappings", "")
    if (mappings.isBlank()) return null
    val sources = jsonArrayToStringList(root.optJSONArray("sources"))
    val names = jsonArrayToStringList(root.optJSONArray("names"))
    val sourceRoot = root.optString("sourceRoot", "").ifBlank { null }
    val lines = parseMappings(mappings)
    if (lines.isEmpty()) return null
    return SourceMapIndex(
      sources = sources,
      names = names,
      sourceRoot = sourceRoot,
      lines = lines,
    )
  }

  private fun jsonArrayToStringList(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val out = ArrayList<String>(array.length())
    for (i in 0 until array.length()) {
      out += array.optString(i, "")
    }
    return out
  }

  private fun parseMappings(mappings: String): List<List<Segment>> {
    val lines = ArrayList<MutableList<Segment>>()
    var previousSource = 0
    var previousOriginalLine = 0
    var previousOriginalColumn = 0
    var previousName = 0

    val lineChunks = mappings.split(';')
    for (lineChunk in lineChunks) {
      var previousGeneratedColumn = 0
      val segments = mutableListOf<Segment>()
      if (lineChunk.isNotEmpty()) {
        val rawSegments = lineChunk.split(',')
        for (raw in rawSegments) {
          if (raw.isEmpty()) continue
          val values = decodeVlq(raw)
          if (values.isEmpty()) continue
          val generatedColumn = previousGeneratedColumn + values[0]
          previousGeneratedColumn = generatedColumn
          if (values.size >= 4) {
            val sourceIndex = previousSource + values[1]
            previousSource = sourceIndex
            val originalLine = previousOriginalLine + values[2]
            previousOriginalLine = originalLine
            val originalColumn = previousOriginalColumn + values[3]
            previousOriginalColumn = originalColumn
            var nameIndex: Int? = null
            if (values.size >= 5) {
              nameIndex = previousName + values[4]
              previousName = nameIndex
            }
            segments += Segment(
              generatedColumn = generatedColumn,
              sourceIndex = sourceIndex,
              originalLine = originalLine,
              originalColumn = originalColumn,
              nameIndex = nameIndex,
            )
          } else {
            segments += Segment(
              generatedColumn = generatedColumn,
              sourceIndex = null,
              originalLine = null,
              originalColumn = null,
              nameIndex = null,
            )
          }
        }
      }
      lines += segments
    }
    return lines
  }

  private fun decodeVlq(segment: String): List<Int> {
    val values = mutableListOf<Int>()
    var index = 0
    while (index < segment.length) {
      var shift = 0
      var result = 0
      var continuation: Boolean
      do {
        if (index >= segment.length) return values
        val digit = fromBase64(segment[index])
        if (digit < 0) return values
        index += 1
        continuation = (digit and 32) != 0
        val valueBits = digit and 31
        result += valueBits shl shift
        shift += 5
      } while (continuation)
      val isNegative = (result and 1) == 1
      val decoded = result shr 1
      values += if (isNegative) -decoded else decoded
    }
    return values
  }

  private fun fromBase64(c: Char): Int {
    return when (c) {
      in 'A'..'Z' -> c.code - 'A'.code
      in 'a'..'z' -> 26 + c.code - 'a'.code
      in '0'..'9' -> 52 + c.code - '0'.code
      '+' -> 62
      '/' -> 63
      else -> -1
    }
  }

  private fun resolveOriginalPosition(index: SourceMapIndex, frame: StackFrame): OriginalPosition {
    val line = frame.lineNumber
    val colInput = frame.column ?: 1
    val colZero = maxOf(0, colInput - 1)

    val candidates = listOf(
      lookupPosition(index, line, colZero, greatestLowerBound = true),
      lookupPosition(index, line, colInput, greatestLowerBound = true),
      lookupPosition(index, line, colZero, greatestLowerBound = false),
      lookupPosition(index, line, colInput, greatestLowerBound = false),
    )
    for (candidate in candidates) {
      if (candidate.source != null) return candidate
    }
    return OriginalPosition(source = null, line = null, column = null, name = null)
  }

  private fun findClosestMapping(index: SourceMapIndex, frame: StackFrame): OriginalPosition {
    val segments = index.lines.getOrNull(frame.lineNumber - 1).orEmpty()
    if (segments.isEmpty()) return OriginalPosition(source = null, line = null, column = null, name = null)
    val targetColumn = frame.column ?: 0
    var best: Segment? = null
    var bestDelta = Int.MAX_VALUE
    for (segment in segments) {
      val sourceIndex = segment.sourceIndex ?: continue
      if (sourceIndex < 0 || sourceIndex >= index.sources.size) continue
      val delta = kotlin.math.abs(segment.generatedColumn - targetColumn)
      if (delta < bestDelta) {
        bestDelta = delta
        best = segment
      }
    }
    return segmentToOriginal(index, best)
  }

  private fun lookupPosition(
    index: SourceMapIndex,
    generatedLine: Int,
    generatedColumn: Int,
    greatestLowerBound: Boolean,
  ): OriginalPosition {
    val segments = index.lines.getOrNull(generatedLine - 1).orEmpty()
    if (segments.isEmpty()) return OriginalPosition(source = null, line = null, column = null, name = null)
    val chosen = if (greatestLowerBound) {
      var best: Segment? = null
      for (segment in segments) {
        if (segment.generatedColumn <= generatedColumn) {
          best = segment
        } else {
          break
        }
      }
      best
    } else {
      var best: Segment? = null
      for (segment in segments) {
        if (segment.generatedColumn >= generatedColumn) {
          best = segment
          break
        }
      }
      best
    }
    return segmentToOriginal(index, chosen)
  }

  private fun segmentToOriginal(index: SourceMapIndex, segment: Segment?): OriginalPosition {
    val sourceIndex = segment?.sourceIndex ?: return OriginalPosition(null, null, null, null)
    if (sourceIndex < 0 || sourceIndex >= index.sources.size) {
      return OriginalPosition(null, null, null, null)
    }
    val source = resolveSource(index.sourceRoot, index.sources[sourceIndex])
    val name = segment.nameIndex?.let { idx ->
      if (idx in 0 until index.names.size) index.names[idx] else null
    }
    return OriginalPosition(
      source = source,
      line = segment.originalLine?.plus(1),
      column = segment.originalColumn,
      name = name,
    )
  }

  private fun resolveSource(sourceRoot: String?, source: String): String {
    if (sourceRoot.isNullOrBlank() || source.startsWith("/") || source.contains("://")) {
      return source
    }
    val left = sourceRoot.trimEnd('/')
    val right = source.trimStart('/')
    return "$left/$right"
  }

  private fun formatFrame(method: String, source: String?, line: Int?, column: Int?): String {
    val safeSource = source ?: "<unknown>"
    val safeLine = line?.toString() ?: "null"
    val safeColumn = column?.toString() ?: "null"
    return "at $method ($safeSource:$safeLine:$safeColumn)"
  }
}
