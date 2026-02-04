package com.zynth.kit.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

private const val DEFAULT_ALPHA = 0x40
private const val DEFAULT_COLOR = (DEFAULT_ALPHA shl 24)

data class ShadowLayer(
  val offsetX: Float = 0f,
  val offsetY: Float = 0f,
  val blurRadius: Float = 0f,
  val spread: Float = 0f,
  val color: Int = DEFAULT_COLOR,
  val inset: Boolean = false,
) {
  fun scale(factor: Float): ShadowLayer = copy(
    offsetX = offsetX * factor,
    offsetY = offsetY * factor,
    blurRadius = blurRadius * factor,
    spread = spread * factor,
  )
}

object ZynthShadowParser {
  private val shadowCache = android.util.LruCache<String, List<ShadowLayer>>(128)
  
  private val COLOR_TOKEN = Regex(
    "(#(?:[0-9a-fA-F]{3,8})|rgba?\\([^)]*\\)|hsla?\\([^)]*\\)|hwb\\([^)]*\\))"
  )

  fun parse(value: Any?): List<ShadowLayer>? {
    if (value is String) {
      val cached = shadowCache.get(value)
      if (cached != null) return cached
      
      val trimmed = value.trim()
      val result = if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        runCatching { JSONArray(trimmed) }.getOrNull()?.let { parseArray(it) }
          ?: runCatching { JSONObject(trimmed) }.getOrNull()?.let { listOfNotNull(parseObject(it)) }
      } else {
        parseStringList(trimmed)
      }
      
      if (result != null && result.isNotEmpty()) {
        shadowCache.put(value, result)
      }
      return result?.takeIf { it.isNotEmpty() }
    }
    
    return when (value) {
      is JSONArray -> parseArray(value)
      is JSONObject -> listOfNotNull(parseObject(value))
      else -> null
    }?.takeIf { it.isNotEmpty() }
  }

  fun fromReactNative(
    shadowColor: Int?,
    shadowOpacity: Float?,
    shadowRadius: Float?,
    offsetX: Float?,
    offsetY: Float?,
  ): List<ShadowLayer>? {
    if (shadowColor == null && shadowOpacity == null && shadowRadius == null && offsetX == null && offsetY == null) {
      return null
    }
    val opacity = shadowOpacity?.coerceIn(0f, 1f) ?: 0f
    val baseColor = shadowColor ?: DEFAULT_COLOR
    val color = applyOpacity(baseColor, opacity)
    return listOf(
      ShadowLayer(
        offsetX = offsetX ?: 0f,
        offsetY = offsetY ?: 0f,
        blurRadius = shadowRadius ?: 0f,
        spread = 0f,
        color = color,
        inset = false,
      )
    )
  }

  fun merge(css: List<ShadowLayer>?, rn: List<ShadowLayer>?): List<ShadowLayer>? {
    return css ?: rn
  }

  private fun parseArray(json: JSONArray): List<ShadowLayer> {
    val shadows = mutableListOf<ShadowLayer>()
    for (i in 0 until json.length()) {
      val item = json.opt(i)
      when (item) {
        is String -> parseString(item.trim())?.let(shadows::add)
        is JSONObject -> parseObject(item)?.let(shadows::add)
      }
    }
    return shadows
  }

  private fun parseObject(obj: JSONObject): ShadowLayer? {
    val offsetX = obj.optDouble("offsetX", Double.NaN)
    val offsetY = obj.optDouble("offsetY", Double.NaN)
    val blur = obj.optDouble("blurRadius", Double.NaN)
    val spread = obj.optDouble("spread", Double.NaN)
    val inset = obj.optBoolean("inset", false)
    val colorString = obj.optString("color").takeIf { it.isNotEmpty() }
    val color = ZynthColorParser.parse(colorString) ?: DEFAULT_COLOR
    return ShadowLayer(
      offsetX = if (offsetX.isNaN()) 0f else offsetX.toFloat(),
      offsetY = if (offsetY.isNaN()) 0f else offsetY.toFloat(),
      blurRadius = if (blur.isNaN()) 0f else blur.toFloat(),
      spread = if (spread.isNaN()) 0f else spread.toFloat(),
      color = color,
      inset = inset,
    )
  }

  private fun parseStringList(value: String): List<ShadowLayer> {
    val shadows = mutableListOf<ShadowLayer>()
    for (part in splitByTopLevelCommas(value)) {
      parseString(part)?.let(shadows::add)
    }
    return shadows
  }

  private fun parseString(raw: String): ShadowLayer? {
    if (raw.isBlank()) return null
    var working = raw.trim().replace("\\s+".toRegex(), " ")
    var inset = false
    if (working.contains("inset", ignoreCase = true)) {
      inset = true
      working = working.replace("(?i)\\binset\\b".toRegex(), "").trim()
    }

    val colorMatch = COLOR_TOKEN.find(working)
    var color: Int? = null
    if (colorMatch != null) {
      color = ZynthColorParser.parse(colorMatch.value)
      working = (working.substring(0, colorMatch.range.first) + working.substring(colorMatch.range.last + 1)).trim()
    }

    val tokens = working.split(" ").filter { it.isNotBlank() }
    val lengths = mutableListOf<Float>()
    for (token in tokens) {
      val length = parseLength(token)
      if (length != null) {
        lengths.add(length)
        continue
      }
      if (color == null) {
        color = ZynthColorParser.parse(token)
      }
    }

    if (lengths.size < 2) return null
    val offsetX = lengths.getOrNull(0) ?: 0f
    val offsetY = lengths.getOrNull(1) ?: 0f
    val blur = lengths.getOrNull(2) ?: 0f
    val spread = lengths.getOrNull(3) ?: 0f

    val resolvedColor = color ?: DEFAULT_COLOR
    return ShadowLayer(offsetX, offsetY, blur, spread, resolvedColor, inset)
  }

  private fun splitByTopLevelCommas(value: String): List<String> {
    val parts = mutableListOf<String>()
    val current = StringBuilder()
    var depth = 0
    value.forEach { c ->
      when (c) {
        '(' -> depth++
        ')' -> if (depth > 0) depth--
        ',' -> if (depth == 0) {
          val part = current.toString().trim()
          if (part.isNotEmpty()) parts.add(part)
          current.setLength(0)
          return@forEach
        }
      }
      current.append(c)
    }
    val tail = current.toString().trim()
    if (tail.isNotEmpty()) parts.add(tail)
    return parts
  }

  private fun parseLength(token: String): Float? {
    val normalized = token.trim().removeSuffix("px")
    return normalized.toFloatOrNull()
  }

  private fun applyOpacity(color: Int, opacity: Float): Int {
    val alpha = ((color shr 24 and 0xFF) * opacity).roundToInt().coerceIn(0, 255)
    return (alpha shl 24) or (color and 0x00FFFFFF)
  }
}
