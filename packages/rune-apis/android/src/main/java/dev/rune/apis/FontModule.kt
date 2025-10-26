package dev.rune.apis

import android.content.Context
import android.util.Log
import com.rune.kit.runtime.FontRegistry
import com.rune.kit.runtime.RuneModule
import org.json.JSONObject

private const val TAG = "FontModule"

/**
 * FontModule - Native module for loading custom fonts from assets.
 * 
 * This module provides the JavaScript Font API with native font loading capabilities.
 * Fonts are loaded from the app's assets/fonts directory and registered in the
 * FontRegistry (in RuneKit) for use by TextComposer when rendering text.
 */
class FontModule(context: Context) : RuneModule {
    override val name = "Font"
    
    private val appContext = context.applicationContext

    init {
        Log.d(TAG, "FontModule constructor called")
    }

    override fun initialize() {
        // Initialize the FontRegistry with app context
        Log.d(TAG, "FontModule.initialize() called - initializing FontRegistry")
        FontRegistry.initialize(appContext)
        Log.d(TAG, "FontModule initialized successfully")
    }

    override fun call(method: String, args: Array<Any?>): JSONObject {
        Log.d(TAG, "FontModule.call() - method: $method, args count: ${args.size}")
        args.forEachIndexed { index, arg ->
            Log.d(TAG, "  arg[$index]: ${arg?.javaClass?.simpleName} = $arg")
        }
        
        return when (method) {
            "loadAsync" -> loadAsync(args)
            else -> {
                Log.w(TAG, "Unknown method: $method")
                JSONObject().apply {
                    put("error", "Unknown method: $method")
                }
            }
        }
    }

    private fun loadAsync(args: Array<Any?>): JSONObject {
        try {
            // args[0] is the object { fontFamily: string, resourceName: string }
            val params = args.getOrNull(0)
            Log.d(TAG, "loadAsync params: $params (type: ${params?.javaClass?.simpleName})")
            
            val fontFamily: String?
            val resourceName: String?
            
            when (params) {
                is JSONObject -> {
                    // optString(key) returns an empty string when missing; convert empty strings to null
                    fontFamily = params.optString("fontFamily").takeIf { it.isNotEmpty() }
                    resourceName = params.optString("resourceName").takeIf { it.isNotEmpty() }
                }
                is Map<*, *> -> {
                    fontFamily = params["fontFamily"] as? String
                    resourceName = params["resourceName"] as? String
                }
                else -> {
                    Log.e(TAG, "loadAsync: invalid params type: ${params?.javaClass?.simpleName}")
                    return JSONObject().apply {
                        put("error", "Invalid arguments - expected object with fontFamily and resourceName")
                    }
                }
            }
            
            if (fontFamily.isNullOrEmpty() || resourceName.isNullOrEmpty()) {
                Log.e(TAG, "loadAsync: missing fontFamily ($fontFamily) or resourceName ($resourceName)")
                return JSONObject().apply {
                    put("error", "Missing fontFamily or resourceName")
                }
            }

            Log.d(TAG, "Loading font: '$fontFamily' from '$resourceName'")
            
            val success = FontRegistry.loadFont(fontFamily, resourceName)
            
            return if (success) {
                Log.d(TAG, "Successfully loaded font: $fontFamily")
                JSONObject().apply {
                    put("success", true)
                }
            } else {
                Log.e(TAG, "Failed to load font: $fontFamily")
                JSONObject().apply {
                    put("error", "Failed to load font '$fontFamily' from '$resourceName'")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "loadAsync error: ${e.message}", e)
            return JSONObject().apply {
                put("error", e.message ?: "Unknown error")
            }
        }
    }
}
