package dev.zynth.apis

import android.content.Context
import com.zynth.kit.runtime.FontRegistry
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

private const val TAG = "FontModule"

/**
 * FontModule - Native module for loading custom fonts from assets.
 * 
 * This module provides the JavaScript Font API with native font loading capabilities.
 * Fonts are loaded from the app's assets/fonts directory and registered in the
 * FontRegistry (in ZynthKit) for use by TextComposer when rendering text.
 */
class FontModule(context: Context, private val runtime: ZynthRuntime? = null) : ZynthModule {
    override val name = "Font"
    
    private val appContext = context.applicationContext

    override fun initialize() {
        FontRegistry.initialize(appContext)
        runtime?.setAssetProvider(FontRegistry)
    }

    override fun call(method: String, args: ZynthArgs): JSONObject {
        val params = try { args.nestedAt(0) } catch (e: Exception) { args }
        return when (method) {
            "loadAsync" -> loadAsync(params)
            else -> {
                JSONObject().apply {
                    put("error", "Unknown method: $method")
                }
            }
        }
    }

    private fun loadAsync(params: ZynthArgs): JSONObject {
        try {
            val fontFamily = try { params.getString("fontFamily") } catch (e: Exception) { null }
            val resourceName = try { params.getString("resourceName") } catch (e: Exception) { null }
            
            if (fontFamily.isNullOrEmpty() || resourceName.isNullOrEmpty()) {
                return JSONObject().apply {
                    put("error", "Missing fontFamily or resourceName")
                }
            }

            val success = FontRegistry.loadFont(fontFamily, resourceName)
            
            return if (success) {
                JSONObject().apply {
                    put("success", true)
                    put("path", FontRegistry.getFontPath(fontFamily))
                }
            } else {
                JSONObject().apply {
                    put("error", "Failed to load font '$fontFamily'")
                }
            }
        } catch (e: Exception) {
            return JSONObject().apply {
                put("error", e.message ?: "Unknown error")
            }
        }
    }
}
