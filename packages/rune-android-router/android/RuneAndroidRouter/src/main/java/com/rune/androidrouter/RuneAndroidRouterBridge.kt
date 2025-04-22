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
class RuneAndroidRouterModule(
    private val navigationContainer: RuneNavigationContainer
) : RuneModule, RuneSyncModule {
    override val name: String = "RuneAndroidRouter"
    
    private val TAG = "RuneAndroidRouterModule"
    
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
                
        // WORKAROUND: The bridge passes JS arrays as nested Object[] instead of flattening
        // So when JS calls modules.call("Module", "method", [arg1, arg2])
        // We receive args = [Object[arg1, arg2]] instead of args = [arg1, arg2]
        val actualArgs = if (args.size == 1 && args[0] is Array<*>) {
            @Suppress("UNCHECKED_CAST")
            (args[0] as Array<Any?>)
        } else {
            args
        }
        
        Log.e(TAG, "🔥 After unwrapping: actualArgs.size=${actualArgs.size}")
        actualArgs.forEachIndexed { index, arg ->
            Log.e(TAG, "  actualArgs[$index]: ${arg?.javaClass?.simpleName} = $arg")
        }
        
        return try {
            when (method) {
                "navigate" -> {
                    val screenName = actualArgs.getOrNull(0) as? String
                    if (screenName == null) {
                        Log.e(TAG, "🔥 ERROR: screenName is null! actualArgs[0]=${actualArgs.getOrNull(0)}, type=${actualArgs.getOrNull(0)?.javaClass}")
                        return errorResponse("Missing screen name")
                    }
                    
                    val paramsJson = actualArgs.getOrNull(1) as? String
                    
                    navigate(screenName, paramsJson)
                    successResponse()
                }
                "goBack" -> {
                    goBack()
                    successResponse()
                }
                "surfaceReady" -> {
                    val surfaceId = (actualArgs.getOrNull(0) as? Number)?.toInt()
                    if (surfaceId != null) {
                        RuneNavigationContainer.notifySurfaceReady(surfaceId, SurfaceReadySource.JS_BRIDGE)
                    } else {
                        Log.w(TAG, "surfaceReady called without surfaceId")
                    }
                    successResponse()
                }
                "surfaceDisposed" -> {
                    val surfaceId = (actualArgs.getOrNull(0) as? Number)?.toInt()
                    if (surfaceId != null) {
                        RuneNavigationContainer.notifySurfaceDisposed(surfaceId)
                    } else {
                        Log.w(TAG, "surfaceDisposed called without surfaceId")
                    }
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
        Log.e(TAG, "🔥 navigate() called: screenName=$screenName, paramsJson=$paramsJson")
        
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
