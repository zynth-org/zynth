package com.rune.components.image

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BlendMode
import android.graphics.BlendModeColorFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.util.LruCache
import android.view.ViewOutlineProvider
import android.widget.ImageView
import androidx.core.graphics.drawable.DrawableCompat
import androidx.core.widget.ImageViewCompat
import coil.ImageLoader
import coil.decode.SvgDecoder
import coil.request.Disposable
import coil.request.ImageRequest
import com.rune.kit.core.ImageState
import com.rune.kit.core.RuneRootView
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.LayoutEngine
import com.rune.kit.layout.MeasureInput
import com.rune.kit.layout.MeasureMode
import com.rune.kit.layout.Style
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlin.math.min
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * RuneImageComponent handles image loading, measurement, and lifecycle for Image nodes.
 * Migrated from core to component package following the migration guide.
 */
internal class RuneImageComponent(
  private val root: RuneRootView,
  private val engine: LayoutEngine,
  private val eventDispatcher: (Int, String) -> Unit,
  private val scheduleFlush: () -> Unit,
  private val storeEventPayload: (Int, String, JSONObject?) -> Unit,
) {
  private val handler = Handler(Looper.getMainLooper())
  private val imageLoader = ImageLoader.Builder(root.context)
    .components {
      add(SvgDecoder.Factory())
    }
    .build()
  private val systemTintCache = LruCache<String, BitmapDrawable>(48)

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
    state.isSystemSource = false
    state.systemName = null
    state.preferredWidth = null
    state.preferredHeight = null
    storeEventPayload(node.id, "onLoad", null)
    storeEventPayload(node.id, "onError", null)
    val imageView = node.view as? ImageView
    handler.post {
      imageView?.setImageDrawable(null)
      imageView?.let { setTint(it, null, state.isSystemSource, state.systemName) }
    }
  }

  fun onStyleApplied(node: RuneUIManager.Node, style: Style) {
    val state = ensureState(node)
    state.preferredWidth = style.width
    state.preferredHeight = style.height
    val imageView = node.view as? ImageView
    if (imageView != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      val defaultRadius = style.borderRadius ?: 0f
      val hasRadius =
        (style.borderTopLeftRadius ?: defaultRadius) > 0f ||
        (style.borderTopRightRadius ?: defaultRadius) > 0f ||
        (style.borderBottomRightRadius ?: defaultRadius) > 0f ||
        (style.borderBottomLeftRadius ?: defaultRadius) > 0f
      imageView.outlineProvider = ViewOutlineProvider.BACKGROUND
      imageView.clipToOutline = hasRadius
    }
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
    data class SystemData(val name: String) : ImageSourceSpec()
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
        val system = value.optString("system", "")
        if (system.isNotEmpty()) {
          return ImageSourceSpec.SystemData(system)
        }
        val data = value.optString("data", "")
        if (data.isNotEmpty()) {
          val scale = value.optDouble("scale", Double.NaN)
          ImageSourceSpec.InlineData(
            data,
            if (!scale.isNaN() && scale > 0) scale.toFloat() else null,
            value.optString("mimeType", "").takeIf { it.isNotBlank() },
          )
        } else {
          val uri = value.optString("uri", "")
          if (uri.isBlank()) {
            null
          } else {
            val lower = uri.lowercase(Locale.US)
            when {
              lower.startsWith("data:") -> {
                val scale = value.optDouble("scale", Double.NaN)
                ImageSourceSpec.InlineData(
                  uri,
                  if (!scale.isNaN() && scale > 0) scale.toFloat() else null,
                  value.optString("mimeType", "").takeIf { it.isNotBlank() },
                )
              }
              !lower.contains("://") && !lower.startsWith("/") -> {
                val scale = value.optDouble("scale", Double.NaN)
                ImageSourceSpec.AssetData(
                  uri,
                  value.optString("bundle", "").takeIf { it.isNotBlank() },
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
    val job = state.job
    if (job is Disposable) {
      job.dispose()
    }
    state.job = null
  }

  private fun applyImageSource(node: RuneUIManager.Node, rawValue: Any?) {
    (node.view as? ImageView) ?: return
    val state = ensureState(node)
    cancelImageRequest(state)
    val spec = normalizeImageSource(rawValue)
    state.isSystemSource = spec is ImageSourceSpec.SystemData
    state.systemName = (spec as? ImageSourceSpec.SystemData)?.name
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
      is ImageSourceSpec.SystemData -> loadSystemImage(node, spec, token)
      is ImageSourceSpec.RemoteData -> loadRemoteImage(node, spec, token)
    }
  }

  private fun clearImage(node: RuneUIManager.Node) {
    val imageView = node.view as? ImageView ?: return
    val state = ensureState(node)
    handler.post {
      imageView.setImageDrawable(null)
      setTint(imageView, state.tintColor, state.isSystemSource, state.systemName)
      state.intrinsicWidth = 0
      state.intrinsicHeight = 0
      engine.markDirty(node.id)
      scheduleFlush()
    }
  }

  private fun loadWithCoil(node: RuneUIManager.Node, data: Any?, token: String, scale: Float = 1f) {
    val state = ensureState(node)
    val request = ImageRequest.Builder(root.context)
      .data(data)
      .target(
        onSuccess = { result ->
          postImageSuccess(node, token, result, scale)
        },
        onError = {
          postImageError(node, token, "Image load failed")
        }
      )
      .build()
    state.job = imageLoader.enqueue(request)
  }

  private fun loadInlineData(node: RuneUIManager.Node, spec: ImageSourceSpec.InlineData, token: String) {
    val bytes = decodeInlineData(spec.payload)
    if (bytes == null) {
      postImageError(node, token, "Failed to decode image data")
      return
    }
    val scale = spec.scale?.takeIf { it > 0f } ?: 1f
    loadWithCoil(node, bytes, token, scale)
  }

  private fun decodeInlineData(raw: String): ByteArray? {
    val payload = raw.substringAfter(',', raw)
    return try {
      Base64.decode(payload, Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      null
    }
  }

  private fun loadSystemImage(node: RuneUIManager.Node, spec: ImageSourceSpec.SystemData, token: String) {
    val context = root.context
    val resources = context.resources
    val pkg = context.packageName

    var resId = resources.getIdentifier(spec.name, "drawable", pkg)
    if (resId == 0) {
      resId = resources.getIdentifier(spec.name, "drawable", "android")
    }

    if (resId == 0) {
      postImageError(node, token, "System image ${spec.name} not found")
      return
    }

    loadWithCoil(node, resId, token, 1f)
  }

  private fun loadAssetImage(node: RuneUIManager.Node, spec: ImageSourceSpec.AssetData, token: String) {
    val path = if (!spec.bundle.isNullOrBlank()) "${spec.bundle}/${spec.name}" else spec.name
    val uri = "file:///android_asset/$path"
    val scale = spec.scale?.takeIf { it > 0f } ?: 1f
    loadWithCoil(node, uri, token, scale)
  }

  private fun loadRemoteImage(node: RuneUIManager.Node, spec: ImageSourceSpec.RemoteData, token: String) {
    val scale = spec.info?.optDouble("scale", Double.NaN)?.takeIf { !it.isNaN() && it > 0 }?.toFloat() ?: 1f
    loadWithCoil(node, spec.uri, token, scale)
  }

  private fun postImageSuccess(node: RuneUIManager.Node, token: String, drawable: Drawable, scale: Float) {
    handler.post {
      val state = node.imageState ?: return@post
      if (state.requestToken != token) {
        return@post
      }
      state.job = null
      val imageView = node.view as? ImageView ?: return@post
      imageView.setImageDrawable(drawable)
      val widthPoints = if (scale > 0f) drawable.intrinsicWidth / scale else drawable.intrinsicWidth.toFloat()
      val heightPoints = if (scale > 0f) drawable.intrinsicHeight / scale else drawable.intrinsicHeight.toFloat()
      state.intrinsicWidth = widthPoints.roundToInt().coerceAtLeast(1)
      state.intrinsicHeight = heightPoints.roundToInt().coerceAtLeast(1)
      setTint(imageView, state.tintColor, state.isSystemSource, state.systemName)
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

  private fun setTint(imageView: ImageView, color: Int?, forceOpaque: Boolean, systemName: String?) {
    if (forceOpaque && color != null) {
      val cacheKey = if (!systemName.isNullOrBlank()) {
        "system:$systemName:${Integer.toHexString(color)}"
      } else {
        null
      }
      if (cacheKey != null) {
        val cached = systemTintCache.get(cacheKey)
        if (cached != null) {
          val drawable =
            cached.constantState?.newDrawable(root.context.resources) ?: cached
          imageView.setImageDrawable(drawable)
          imageView.colorFilter = null
          return
        }
      }
      val drawable = imageView.drawable
      if (drawable != null) {
        val tinted = DrawableCompat.wrap(drawable.mutate())
        DrawableCompat.setTint(tinted, color)
        DrawableCompat.setTintMode(tinted, PorterDuff.Mode.SRC_IN)
        val alpha = Color.alpha(color)
        val opaque = forceOpaqueDrawable(tinted, alpha)
        if (cacheKey != null) {
          systemTintCache.put(cacheKey, opaque)
        }
        imageView.setImageDrawable(opaque)
        imageView.colorFilter = null
        return
      }
    }
    if (color != null) {
      // Use ColorFilter with SRC_ATOP mode to blend the tint with the image
      // This allows the image to show through the tint color
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        imageView.colorFilter = BlendModeColorFilter(color, BlendMode.SRC_ATOP)
      } else {
        @Suppress("DEPRECATION")
        imageView.setColorFilter(color, PorterDuff.Mode.SRC_ATOP)
      }
    } else {
      imageView.colorFilter = null
    }
  }

  private fun forceOpaqueDrawable(drawable: Drawable, alpha: Int): BitmapDrawable {
    val width = drawable.intrinsicWidth.takeIf { it > 0 } ?: 1
    val height = drawable.intrinsicHeight.takeIf { it > 0 } ?: 1
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, width, height)
    drawable.draw(canvas)
    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    val targetAlpha = alpha.coerceIn(0, 255)
    for (i in pixels.indices) {
      if ((pixels[i] ushr 24) != 0) {
        pixels[i] = (targetAlpha shl 24) or (pixels[i] and 0x00FFFFFF)
      }
    }
    bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
    return BitmapDrawable(root.context.resources, bitmap)
  }

  private fun applyTintColor(node: RuneUIManager.Node, imageView: ImageView, value: Any?) {
    val state = ensureState(node)
    val color = when (value) {
      is String -> parseColorString(value)
      else -> null
    }
    state.tintColor = color
    setTint(imageView, color, state.isSystemSource, state.systemName)
  }

  private fun parseColorString(raw: String?): Int? {
    if (raw.isNullOrBlank()) return null

    val trimmed = raw.trim()

    // Handle rgba(r,g,b,a) format by converting to argb(a,r,g,b)
    if (trimmed.startsWith("rgba(", ignoreCase = true) && trimmed.endsWith(")")) {
      try {
        val content = trimmed.substring(5, trimmed.length - 1) // Remove "rgba(" and ")"
        val parts = content.split(",").map { it.trim() }
        if (parts.size == 4) {
          val r = parts[0].toFloatOrNull()?.roundToInt() ?: return null
          val g = parts[1].toFloatOrNull()?.roundToInt() ?: return null
          val b = parts[2].toFloatOrNull()?.roundToInt() ?: return null
          val a = (parts[3].toFloatOrNull()?.times(255))?.roundToInt() ?: return null
          return Color.argb(a.coerceIn(0, 255), r.coerceIn(0, 255), g.coerceIn(0, 255), b.coerceIn(0, 255))
        }
      } catch (e: Exception) {
        // Fall through to standard parsing
      }
    }

    return try {
      Color.parseColor(trimmed)
    } catch (_: IllegalArgumentException) {
      when (trimmed.lowercase(Locale.US)) {
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
