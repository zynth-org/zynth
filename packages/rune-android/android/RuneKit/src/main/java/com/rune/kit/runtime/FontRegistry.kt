package com.rune.kit.runtime

import android.content.Context
import android.graphics.Typeface
import android.util.Log
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "FontRegistry"

/**
 * Registry for dynamically loaded fonts from assets.
 * Fonts are cached by family name for efficient reuse.
 * 
 * This is shared between RuneKit (TextComposer) and FontModule (in rune-apis).
 */
object FontRegistry {
    private val loadedFonts = ConcurrentHashMap<String, Typeface>()
    private var appContext: Context? = null

    fun initialize(context: Context) {
        appContext = context.applicationContext
    }

    /**
     * Load a font from assets and register it with the given family name.
     * Returns true if successful, false otherwise.
     */
    fun loadFont(fontFamily: String, resourceName: String): Boolean {
        if (loadedFonts.containsKey(fontFamily)) {
            Log.d(TAG, "Font '$fontFamily' already loaded")
            return true
        }

        val ctx = appContext
        if (ctx == null) {
            Log.e(TAG, "FontRegistry not initialized - call initialize() first")
            return false
        }

        return try {
            // resourceName is the font filename, e.g., "rune-icons.ttf"
            // Load from assets/fonts/ directory
            val assetPath = "fonts/$resourceName"
            Log.d(TAG, "Loading font '$fontFamily' from assets: $assetPath")
            
            val typeface = Typeface.createFromAsset(ctx.assets, assetPath)
            loadedFonts[fontFamily] = typeface
            Log.d(TAG, "Successfully loaded font '$fontFamily'")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load font '$fontFamily' from '$resourceName': ${e.message}")
            false
        }
    }

    /**
     * Get a loaded font by family name.
     * Returns null if the font hasn't been loaded.
     */
    fun getTypeface(fontFamily: String): Typeface? {
        return loadedFonts[fontFamily]
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
