package com.rune.androidrouter

import android.util.Log
import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneSyncModule
import org.json.JSONObject

/**
 * Minimal Android Router Module - Implements RuneModule interface to register with the runtime.
 * 
 * This provides just the essential methods needed to initialize and navigate
 * a single-screen router without complexity.
 */
class RuneAndroidRouterModule : RuneModule, RuneSyncModule {
    override val name: String = "RuneAndroidRouter"
    
    private val TAG = "RuneAndroidRouterModule"
    private val navigationContainer = RuneNavigationContainer()
    
    override val constants: Map<String, Any>?
        get() = mapOf(
            "moduleName" to name,
            "version" to "0.0.1"
        )
    
    override fun initialize() {
        Log.d(TAG, "RuneAndroidRouter module initialized")
    }
    
    override fun invalidate() {
        Log.d(TAG, "RuneAndroidRouter module invalidated")
    }
    
    override fun call(method: String, args: Array<Any?>): JSONObject {
        Log.d(TAG, "call: method=$method, args=${args.size}")
        
        return try {
            when (method) {
                "navigate" -> {
                    val screenName = args.getOrNull(0) as? String 
                        ?: return errorResponse("Missing screen name")
                    val paramsJson = args.getOrNull(1) as? String
                    navigate(screenName, paramsJson)
                    successResponse()
                }
                "goBack" -> {
                    goBack()
                    successResponse()
                }
                "getState" -> {
                    JSONObject().apply {
                        put("ok", true)
                        put("result", null) // Will be managed by JS side
                    }
                }
                else -> errorResponse("Unknown method: $method")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in call($method)", e)
            errorResponse(e.message ?: "Unknown error")
        }
    }
    
    override fun callSync(method: String, args: Array<Any?>): Any? {
        Log.d(TAG, "callSync: method=$method, args=${args.size}")
        
        return when (method) {
            "getState" -> {
                // Return null - will be managed by JS side for minimal implementation
                null
            }
            else -> throw UnsupportedOperationException("Sync method not supported: $method")
        }
    }
    
    private fun navigate(screenName: String, paramsJson: String?) {
        Log.d(TAG, "Navigate to: $screenName with params: $paramsJson")
        
        val params = paramsJson?.let {
            try {
                JSONObject(it)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse params JSON", e)
                null
            }
        }
        
        navigationContainer.pushScreen(screenName, params)
    }
    
    private fun goBack() {
        Log.d(TAG, "Go back")
        navigationContainer.popScreen()
    }
    
    private fun successResponse(): JSONObject {
        return JSONObject().put("ok", true)
    }
    
    private fun errorResponse(message: String): JSONObject {
        return JSONObject()
            .put("ok", false)
            .put("error", message)
    }
}
