package com.zynth.kit.runtime

import android.content.Context
import android.graphics.Typeface
import android.util.Log
import com.zynth.kit.core.AssetProvider
import java.io.File
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "FontRegistry"
private const val DEBUG_FONTS = false

/**
 * Registry for dynamically loaded fonts from assets.
 * Fonts are cached by family name for efficient reuse.
 *
 * This is shared between ZynthKit text rendering and FontModule (in zynth-apis).
 */
object FontRegistry : AssetProvider {
  private val loadedFonts = ConcurrentHashMap<String, Typeface>()
  private var appContext: Context? = null

  fun initialize(context: Context) {
    appContext = context.applicationContext
  }

  override fun getTypeface(family: String): Typeface? {
    val typeface = loadedFonts[family]
    if (DEBUG_FONTS) {
      Log.d(TAG, "getTypeface('$family') -> ${if (typeface != null) "Found" else "Not Found"}. Loaded fonts: ${loadedFonts.keys}")
    }
    return typeface
  }

  /**
   * Load a font from assets and register it with the given family name.
   * Returns true if successful, false otherwise.
   */
  fun loadFont(fontFamily: String, resourceName: String): Boolean {
    if (loadedFonts.containsKey(fontFamily)) {
      if (DEBUG_FONTS) {
        Log.d(TAG, "Font '$fontFamily' already loaded")
      }
      return true
    }

    val ctx = appContext
    if (ctx == null) {
      Log.e(TAG, "FontRegistry not initialized - call initialize() first")
      return false
    }

    val normalized = resourceName.trim().removePrefix("./")
    val candidates = linkedSetOf(
      normalized,
      "fonts/$normalized",
      "assets/fonts/$normalized",
      "src/assets/fonts/$normalized",
      "app/src/main/assets/fonts/$normalized",
      "main/assets/fonts/$normalized",
    )
    val fileName = normalized.substringAfterLast('/').substringAfterLast('\\')
    if (fileName.isNotEmpty() && fileName != normalized) {
      candidates.add(fileName)
      candidates.add("fonts/$fileName")
      candidates.add("assets/fonts/$fileName")
      candidates.add("src/assets/fonts/$fileName")
    }

    for (assetPath in candidates) {
      try {
        if (DEBUG_FONTS) {
          Log.d(TAG, "Trying font '$fontFamily' from assets: $assetPath")
        }
        val typeface = Typeface.createFromAsset(ctx.assets, assetPath)
        loadedFonts[fontFamily] = typeface
        if (DEBUG_FONTS) {
          Log.d(TAG, "Successfully loaded font '$fontFamily' from asset: $assetPath")
        }
        return true
      } catch (_: Exception) {
        // Try next candidate.
      }
    }

    val fileCandidates = mutableListOf<String>()
    fileCandidates.add(normalized)
    if (fileName.isNotEmpty() && fileName != normalized) {
      fileCandidates.add(fileName)
    }

    // Handle remote URLs
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
      try {
        if (DEBUG_FONTS) {
          Log.d(TAG, "Downloading font '$fontFamily' from URL: $normalized")
        }
        val url = java.net.URL(normalized)
        val connection = url.openConnection() as java.net.HttpURLConnection
        connection.connectTimeout = 30000
        connection.readTimeout = 30000
        
        val cacheFile = File(ctx.cacheDir, "zynth_font_${fontFamily}_${fileName.ifEmpty { "remote" }}")
        connection.inputStream.use { input ->
          cacheFile.outputStream().use { output ->
            input.copyTo(output)
          }
        }
        
        val typeface = Typeface.createFromFile(cacheFile)
        loadedFonts[fontFamily] = typeface
        if (DEBUG_FONTS) {
          Log.d(TAG, "Successfully loaded font '$fontFamily' from URL: $normalized")
        }
        return true
      } catch (e: Exception) {
        Log.e(TAG, "Failed to download font from URL: $normalized", e)
      }
    }

    for (path in fileCandidates) {
      try {
        val file = File(path)
        if (!file.exists()) continue
        val typeface = Typeface.createFromFile(file)
        loadedFonts[fontFamily] = typeface
        if (DEBUG_FONTS) {
          Log.d(TAG, "Successfully loaded font '$fontFamily' from file: ${file.absolutePath}")
        }
        return true
      } catch (_: Exception) {
        // Try next candidate.
      }
    }

    Log.e(TAG, "Failed to load font '$fontFamily' from '$resourceName'")
    return false
  }

  /**
   * Check if a font family has been loaded.
   */
  fun isLoaded(fontFamily: String): Boolean {
    return loadedFonts.containsKey(fontFamily)
  }

  /**
   * Clear all loaded fonts (useful for testing or cleanup).
   */
  fun clear() {
    loadedFonts.clear()
  }
}
