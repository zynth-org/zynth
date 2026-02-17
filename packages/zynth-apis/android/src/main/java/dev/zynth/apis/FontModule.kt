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

    override val exportedMethods: List<String> = listOf("loadAsync")
    
    private val appContext = context.applicationContext

    override fun initialize() {
        FontRegistry.initialize(appContext)
        runtime?.setAssetProvider(FontRegistry)
    }

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "loadAsync" -> resultResponse(loadAsync(args))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun loadAsync(params: ZynthArgs): JSONObject {
        val fontFamily = params.getString("fontFamily")
        val resourceName = params.getString("resourceName")
        
        if (fontFamily.isEmpty() || resourceName.isEmpty()) {
            throw IllegalArgumentException("Missing fontFamily or resourceName")
        }

        val success = FontRegistry.loadFont(fontFamily, resourceName)
        
        if (success) {
            return JSONObject().apply {
                put("success", true)
                put("path", FontRegistry.getFontPath(fontFamily))
            }
        } else {
            throw IllegalStateException("Failed to load font '$fontFamily'")
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
