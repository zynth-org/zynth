package com.rune.kit.core

import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.util.Base64
import android.util.Log
import android.widget.ImageView
import androidx.core.widget.ImageViewCompat
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.MeasureInput
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Style
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import kotlin.math.min
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

data class ImageState(
  var requestToken: String = "",
  var job: Future<*>? = null,
  var tintColor: Int? = null,
  var hasOnLoadHandler: Boolean = false,
  var hasOnErrorHandler: Boolean = false,
  var intrinsicWidth: Int = 0,
  var intrinsicHeight: Int = 0,
  var preferredWidth: Float? = null,
  var preferredHeight: Float? = null,
)

internal class RuneImageSupport(
  private val root: RuneRootView,
  private val engine: LayoutEngine,
  private val handler: Handler,
  private val eventDispatcher: (Int, String) -> Unit,
  private val scheduleFlush: () -> Unit,
  private val storeEventPayload: (Int, String, JSONObject?) -> Unit,
  private val runOnMainThread: ((() -> Unit) -> Unit),
) {
  private val imageExecutor: ExecutorService = Executors.newFixedThreadPool(4) { runnable ->
    Thread(runnable, "RuneImageLoader").apply { isDaemon = true }
  }

  fun initializeNode(node: RuneUIManager.Node) {
    if (node.imageState == null) {
      node.imageState = ImageState()
    }
  }

  fun measure(node: RuneUIManager.Node, input: MeasureInput): Pair<Float, Float> {
    val state = node.imageState
    val imageView = node.view as? ImageView
    val drawable = imageView?.drawable
    val placeholderWidth = state?.preferredWidth?.takeIf { it > 0f }
    val placeholderHeight = state?.preferredHeight?.takeIf { it > 0f }
    val intrinsicWidth = when {
      state?.intrinsicWidth != null && state.intrinsicWidth > 0 -> state.intrinsicWidth
      drawable != null && drawable.intrinsicWidth > 0 -> drawable.intrinsicWidth
      placeholderWidth != null -> placeholderWidth.roundToInt()
      else -> 1
    }
    val intrinsicHeight = when {
      state?.intrinsicHeight != null && state.intrinsicHeight > 0 -> state.intrinsicHeight
      drawable != null && drawable.intrinsicHeight > 0 -> drawable.intrinsicHeight
      placeholderHeight != null -> placeholderHeight.roundToInt()
      else -> 1
    }
    val width = when (input.widthMode) {
      MeasureMode.EXACTLY -> when {
        input.width.isNaN() -> placeholderWidth ?: intrinsicWidth.toFloat()
        else -> input.width
      }
      MeasureMode.AT_MOST -> {
        val available = if (input.width.isNaN()) Float.MAX_VALUE else input.width
        val desired = placeholderWidth ?: intrinsicWidth.toFloat()
        min(available, desired)
      }
      MeasureMode.UNDEFINED -> placeholderWidth ?: intrinsicWidth.toFloat()
    }
    val height = when (input.heightMode) {
      MeasureMode.EXACTLY -> when {
        input.height.isNaN() -> placeholderHeight ?: intrinsicHeight.toFloat()
        else -> input.height
      }
      MeasureMode.AT_MOST -> {
        val available = if (input.height.isNaN()) Float.MAX_VALUE else input.height
        val desired = placeholderHeight ?: intrinsicHeight.toFloat()
        min(available, desired)
      }
      MeasureMode.UNDEFINED -> placeholderHeight ?: intrinsicHeight.toFloat()
    }
    return width.coerceAtLeast(1f) to height.coerceAtLeast(1f)
  }

  fun handleProp(node: RuneUIManager.Node, name: String, jsonValue: String?): Boolean {
    val imageView = node.view as? ImageView ?: return false
    val state = ensureState(node)
    return when (name) {
      "source" -> {
        val value = parseJsonValue(jsonValue)
        applyImageSource(node, value)
        true
      }
      "resizeMode" -> {
        val value = parseJsonValue(jsonValue)
        applyResizeMode(imageView, value as? String)
        true
      }
      "tintColor" -> {
        val value = parseJsonValue(jsonValue)
        applyTintColor(node, imageView, value)
        true
      }
      "onLoad" -> {
        if (jsonValue == null || jsonValue == "null") {
          state.hasOnLoadHandler = false
          storeEventPayload(node.id, "onLoad", null)
        }
        true
      }
      "onError" -> {
        if (jsonValue == null || jsonValue == "null") {
          state.hasOnErrorHandler = false
          storeEventPayload(node.id, "onError", null)
        }
        true
      }
      else -> false
    }
  }

  fun onHandlerSet(node: RuneUIManager.Node, event: String) {
    val state = ensureState(node)
    when (event) {
      "onLoad" -> state.hasOnLoadHandler = true
      "onError" -> state.hasOnErrorHandler = true
    }
  }

  fun cleanup(node: RuneUIManager.Node) {
    val state = node.imageState ?: return
    cancelImageRequest(state)
    state.requestToken = ""
    state.hasOnLoadHandler = false
    state.hasOnErrorHandler = false
    state.preferredWidth = null
    state.preferredHeight = null
    storeEventPayload(node.id, "onLoad", null)
    storeEventPayload(node.id, "onError", null)
    val imageView = node.view as? ImageView
    runOnMainThread {
      imageView?.setImageDrawable(null)
      imageView?.let { setTint(it, null) }
    }
  }

  fun onStyleApplied(node: RuneUIManager.Node, style: Style) {
    val state = ensureState(node)
    state.preferredWidth = style.width
    state.preferredHeight = style.height
    engine.markDirty(node.id)
    scheduleFlush()
  }

  private fun ensureState(node: RuneUIManager.Node): ImageState {
    val existing = node.imageState
    if (existing != null) return existing
    val newState = ImageState()
    node.imageState = newState
    return newState
  }

  private fun parseJsonValue(raw: String?): Any? {
    if (raw == null) return null
    val trimmed = raw.trim()
    if (trimmed.isEmpty() || trimmed == "null") return null
    return try {
      val tokener = JSONTokener(trimmed)
      val value = tokener.nextValue()
      if (value === JSONObject.NULL) null else value
    } catch (_: JSONException) {
      trimmed
    }
  }

  private sealed class ImageSourceSpec {
    data class InlineData(val payload: String, val scale: Float?, val mimeType: String?) : ImageSourceSpec()
    data class AssetData(val name: String, val bundle: String?, val scale: Float?) : ImageSourceSpec()
    data class RemoteData(val uri: String, val info: JSONObject?) : ImageSourceSpec()
  }

  private fun normalizeImageSource(value: Any?): ImageSourceSpec? {
    return when (value) {
      null -> null
      is JSONArray -> {
        for (i in 0 until value.length()) {
          val candidate = normalizeImageSource(value.opt(i))
          if (candidate != null) return candidate
        }
        null
      }
      is JSONObject -> {
        val data = value.optString("data", null)
        if (!data.isNullOrEmpty()) {
          val scale = value.optDouble("scale", Double.NaN)
          ImageSourceSpec.InlineData(
            data,
            if (!scale.isNaN() && scale > 0) scale.toFloat() else null,
            value.optString("mimeType", null).takeIf { !it.isNullOrBlank() },
          )
        } else {
          val uri = value.optString("uri", null)
          if (uri.isNullOrBlank()) {
            null
          } else {
            val lower = uri.lowercase(Locale.US)
            when {
              lower.startsWith("data:") -> {
                val scale = value.optDouble("scale", Double.NaN)
                ImageSourceSpec.InlineData(
                  uri,
                  if (!scale.isNaN() && scale > 0) scale.toFloat() else null,
                  value.optString("mimeType", null).takeIf { !it.isNullOrBlank() },
                )
              }
              !lower.contains("://") && !lower.startsWith("/") -> {
                val scale = value.optDouble("scale", Double.NaN)
                ImageSourceSpec.AssetData(
                  uri,
                  value.optString("bundle", null).takeIf { !it.isNullOrBlank() },
                  if (!scale.isNaN() && scale > 0) scale.toFloat() else null,
                )
              }
              else -> ImageSourceSpec.RemoteData(uri, value)
            }
          }
        }
      }
      is String -> {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) {
          null
        } else {
          val lower = trimmed.lowercase(Locale.US)
          when {
            lower.startsWith("data:") -> ImageSourceSpec.InlineData(trimmed, null, null)
            !lower.contains("://") && !lower.startsWith("/") -> ImageSourceSpec.AssetData(trimmed, null, null)
            else -> ImageSourceSpec.RemoteData(trimmed, null)
          }
        }
      }
      else -> null
    }
  }

  private fun cancelImageRequest(state: ImageState) {
    state.job?.cancel(true)
    state.job = null
  }

  private fun applyImageSource(node: RuneUIManager.Node, rawValue: Any?) {
    val imageView = node.view as? ImageView ?: return
    val state = ensureState(node)
    cancelImageRequest(state)
    val spec = normalizeImageSource(rawValue)
    if (spec == null) {
      state.requestToken = ""
      clearImage(node)
      return
    }
    val token = UUID.randomUUID().toString()
    state.requestToken = token
    when (spec) {
      is ImageSourceSpec.InlineData -> loadInlineData(node, spec, token)
      is ImageSourceSpec.AssetData -> loadAssetImage(node, spec, token)
      is ImageSourceSpec.RemoteData -> loadRemoteImage(node, spec, token)
    }
  }

  private fun clearImage(node: RuneUIManager.Node) {
    val imageView = node.view as? ImageView ?: return
    val state = ensureState(node)
    runOnMainThread {
      imageView.setImageDrawable(null)
      setTint(imageView, state.tintColor)
      state.intrinsicWidth = 0
      state.intrinsicHeight = 0
      engine.markDirty(node.id)
      scheduleFlush()
    }
  }

  private fun loadInlineData(node: RuneUIManager.Node, spec: ImageSourceSpec.InlineData, token: String) {
    val state = ensureState(node)
    state.job = imageExecutor.submit {
      try {
        val payload = spec.payload
        val bytes = decodeInlineData(payload)
        if (bytes == null) {
          postImageError(node, token, "Failed to decode image data")
          return@submit
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (bitmap == null) {
          postImageError(node, token, "Unable to decode image bytes")
          return@submit
        }
        val scale = spec.scale?.takeIf { it > 0f } ?: 1f
        postImageSuccess(node, token, bitmap, scale)
      } catch (t: Throwable) {
        postImageError(node, token, t.message ?: "Image decode failed")
      }
    }
  }

  private fun decodeInlineData(raw: String): ByteArray? {
    val payload = raw.substringAfter(',', raw)
    return try {
      Base64.decode(payload, Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      null
    }
  }

  private fun loadAssetImage(node: RuneUIManager.Node, spec: ImageSourceSpec.AssetData, token: String) {
    val state = ensureState(node)
    state.job = imageExecutor.submit {
      try {
        val stream = openAssetStream(spec)
        if (stream == null) {
          postImageError(node, token, "Asset ${spec.name} not found")
          return@submit
        }
        stream.use {
          val bytes = it.readBytes()
          val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
          if (bitmap == null) {
            postImageError(node, token, "Unable to decode asset ${spec.name}")
            return@use
          }
          val scale = spec.scale?.takeIf { it > 0f } ?: 1f
          postImageSuccess(node, token, bitmap, scale)
        }
      } catch (t: Throwable) {
        postImageError(node, token, t.message ?: "Asset load failed")
      }
    }
  }

  private fun openAssetStream(spec: ImageSourceSpec.AssetData): InputStream? {
    val context = root.context
    val candidates = buildList {
      if (!spec.bundle.isNullOrBlank()) add("${spec.bundle}/${spec.name}")
      add(spec.name)
    }
    val assets = context.assets
    for (path in candidates) {
      try {
        return assets.open(path)
      } catch (_: Exception) {
        // try next candidate
      }
    }
    val resources = context.resources
    val pkg = context.packageName
    val resourceName = spec.name.substringBeforeLast('.')
    val resId = resources.getIdentifier(resourceName, "drawable", pkg)
    return if (resId != 0) resources.openRawResource(resId) else null
  }

  private fun loadRemoteImage(node: RuneUIManager.Node, spec: ImageSourceSpec.RemoteData, token: String) {
    val state = ensureState(node)
    state.job = imageExecutor.submit {
      try {
        val uri = spec.uri
        val lower = uri.lowercase(Locale.US)
        when {
          lower.startsWith("file:") -> {
            val file = File(Uri.parse(uri).path ?: uri.removePrefix("file:"))
            if (!file.exists()) {
              postImageError(node, token, "File ${file.path} not found")
              return@submit
            }
            val bitmap = BitmapFactory.decodeFile(file.absolutePath)
            if (bitmap == null) {
              postImageError(node, token, "Unable to decode file image")
              return@submit
            }
            val scale = spec.info?.optDouble("scale", Double.NaN)?.takeIf { !it.isNaN() && it > 0 }?.toFloat() ?: 1f
            postImageSuccess(node, token, bitmap, scale)
            return@submit
          }
          lower.startsWith("content:") -> {
            val resolver = root.context.contentResolver
            val stream = resolver.openInputStream(Uri.parse(uri))
            if (stream == null) {
              postImageError(node, token, "Content URI not accessible")
              return@submit
            }
            stream.use {
              val bytes = it.readBytes()
              val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
              if (bitmap == null) {
                postImageError(node, token, "Unable to decode content URI")
                return@use
              }
              val scale = spec.info?.optDouble("scale", Double.NaN)?.takeIf { !it.isNaN() && it > 0 }?.toFloat() ?: 1f
              postImageSuccess(node, token, bitmap, scale)
            }
            return@submit
          }
          lower.startsWith("/") -> {
            val file = File(uri)
            if (!file.exists()) {
              postImageError(node, token, "Image at ${file.path} not found")
              return@submit
            }
            val bitmap = BitmapFactory.decodeFile(file.absolutePath)
            if (bitmap == null) {
              postImageError(node, token, "Unable to decode image at ${file.path}")
              return@submit
            }
            val scale = spec.info?.optDouble("scale", Double.NaN)?.takeIf { !it.isNaN() && it > 0 }?.toFloat() ?: 1f
            postImageSuccess(node, token, bitmap, scale)
            return@submit
          }
        }
        val download = downloadRemoteBytes(uri, spec.info)
        val bytes = download.bytes
        if (bytes == null) {
          postImageError(node, token, download.error ?: "Image request failed")
          return@submit
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (bitmap == null) {
          postImageError(node, token, "Unable to decode image data")
          return@submit
        }
        val scale = spec.info?.optDouble("scale", Double.NaN)?.takeIf { !it.isNaN() && it > 0 }?.toFloat() ?: 1f
        postImageSuccess(node, token, bitmap, scale)
      } catch (t: Throwable) {
        postImageError(node, token, t.message ?: "Image request failed")
      }
    }
  }

  private data class DownloadResult(
    val bytes: ByteArray? = null,
    val error: String? = null,
  )

  private fun downloadRemoteBytes(uri: String, info: JSONObject?): DownloadResult {
    var connection: HttpURLConnection? = null
    return try {
      val url = URL(uri)
      connection = (url.openConnection() as? HttpURLConnection)
        ?: return DownloadResult(error = "Image request failed: unsupported protocol")
      connection.connectTimeout = 15000
      connection.readTimeout = 30000
      val method = info?.optString("method", null)?.takeIf { !it.isNullOrBlank() }?.uppercase(Locale.US) ?: "GET"
      connection.requestMethod = method
      val headers = info?.optJSONObject("headers")
      if (headers != null) {
        val keys = headers.keys()
        while (keys.hasNext()) {
          val key = keys.next()
          val value = headers.optString(key, null)
          if (!key.isNullOrBlank() && !value.isNullOrBlank()) {
            connection.setRequestProperty(key, value)
          }
        }
      }
      val body = info?.optString("body", null)
      if (!body.isNullOrEmpty() && method != "GET" && method != "HEAD") {
        connection.doOutput = true
        connection.outputStream.use { it.write(body.toByteArray()) }
      }
      connection.instanceFollowRedirects = true
      connection.connect()
      val code = connection.responseCode
      if (code < 200 || code >= 300) {
        Log.w("RuneUI", "Image request $uri failed with HTTP $code")
        DownloadResult(error = "Image request failed with HTTP $code")
      } else {
        DownloadResult(bytes = connection.inputStream.use { it.readBytes() })
      }
    } catch (t: Throwable) {
      Log.e("RuneUI", "Image download failed for $uri", t)
      val message = t.message ?: t.javaClass.simpleName
      DownloadResult(error = "Image request failed: $message")
    } finally {
      connection?.disconnect()
    }
  }

  private fun postImageSuccess(node: RuneUIManager.Node, token: String, bitmap: Bitmap, scale: Float) {
    handler.post {
      val state = node.imageState ?: return@post
      if (state.requestToken != token) {
        if (!bitmap.isRecycled) {
          bitmap.recycle()
        }
        return@post
      }
      state.job = null
      val imageView = node.view as? ImageView ?: return@post
      imageView.setImageBitmap(bitmap)
      val widthPoints = if (scale > 0f) bitmap.width / scale else bitmap.width.toFloat()
      val heightPoints = if (scale > 0f) bitmap.height / scale else bitmap.height.toFloat()
      state.intrinsicWidth = widthPoints.roundToInt().coerceAtLeast(1)
      state.intrinsicHeight = heightPoints.roundToInt().coerceAtLeast(1)
      setTint(imageView, state.tintColor)
      engine.markDirty(node.id)
      scheduleFlush()
      dispatchImageLoadEvent(node, widthPoints, heightPoints)
    }
  }

  private fun postImageError(node: RuneUIManager.Node, token: String, message: String) {
    handler.post {
      val state = node.imageState ?: return@post
      if (state.requestToken != token) {
        return@post
      }
      state.job = null
      dispatchImageErrorEvent(node, message)
    }
  }

  private fun dispatchImageLoadEvent(node: RuneUIManager.Node, width: Float, height: Float) {
    val state = node.imageState ?: return
    if (!state.hasOnLoadHandler) {
      storeEventPayload(node.id, "onLoad", null)
      return
    }
    try {
      val payload = JSONObject()
      payload.put("target", node.id)
      payload.put("width", width.toDouble())
      payload.put("height", height.toDouble())
      dispatchImageEvent(node, "onLoad", payload)
    } catch (_: JSONException) {
      storeEventPayload(node.id, "onLoad", null)
      eventDispatcher(node.id, "onLoad")
    }
  }

  private fun dispatchImageErrorEvent(node: RuneUIManager.Node, message: String?) {
    val state = node.imageState ?: return
    if (!state.hasOnErrorHandler) {
      storeEventPayload(node.id, "onError", null)
      return
    }
    try {
      val payload = JSONObject()
      payload.put("target", node.id)
      if (!message.isNullOrBlank()) {
        payload.put("message", message)
      }
      dispatchImageEvent(node, "onError", payload)
    } catch (_: JSONException) {
      storeEventPayload(node.id, "onError", null)
      eventDispatcher(node.id, "onError")
    }
  }

  private fun dispatchImageEvent(node: RuneUIManager.Node, event: String, payload: JSONObject) {
    if (!payload.has("target")) {
      try {
        payload.put("target", node.id)
      } catch (_: JSONException) {
        // ignore
      }
    }
    storeEventPayload(node.id, event, payload)
    eventDispatcher(node.id, event)
  }

  private fun applyResizeMode(imageView: ImageView, value: String?) {
    val mode = value?.lowercase(Locale.US)
    val scaleType = when (mode) {
      "contain" -> ImageView.ScaleType.FIT_CENTER
      "stretch" -> ImageView.ScaleType.FIT_XY
      "center" -> ImageView.ScaleType.CENTER
      else -> ImageView.ScaleType.CENTER_CROP
    }
    imageView.scaleType = scaleType
  }

  private fun setTint(imageView: ImageView, color: Int?) {
    if (color != null) {
      ImageViewCompat.setImageTintList(imageView, ColorStateList.valueOf(color))
    } else {
      ImageViewCompat.setImageTintList(imageView, null)
    }
  }

  private fun applyTintColor(node: RuneUIManager.Node, imageView: ImageView, value: Any?) {
    val state = ensureState(node)
    val color = when (value) {
      is String -> parseColorString(value)
      else -> null
    }
    state.tintColor = color
    setTint(imageView, color)
  }

  private fun parseColorString(raw: String?): Int? {
    if (raw.isNullOrBlank()) return null
    return try {
      Color.parseColor(raw)
    } catch (_: IllegalArgumentException) {
      when (raw.lowercase(Locale.US)) {
        "transparent" -> Color.TRANSPARENT
        "black" -> Color.BLACK
        "white" -> Color.WHITE
        "red" -> Color.RED
        "green" -> Color.GREEN
        "blue" -> Color.BLUE
        "yellow" -> Color.YELLOW
        "gray", "grey" -> Color.GRAY
        else -> null
      }
    }
  }
}
