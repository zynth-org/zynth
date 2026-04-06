package com.zynth.kit.runtime

import android.util.Log
import org.json.JSONObject

private const val TAG = "ZynthModuleRegistry"

interface ZynthModule {
    val name: String
    val constants: Map<String, Any>?
        get() = null
    val exportedMethods: List<String>
        get() = emptyList()
    val protectedMethods: List<String>
        get() = emptyList()
    fun call(method: String, args: ZynthArgs): JSONObject
    fun initialize() {}
    fun invalidate() {}
}

interface ZynthSyncModule {
    fun callSync(method: String, args: ZynthArgs): Any?
}

class ZynthModuleRegistry {
    private val modules = mutableMapOf<String, ZynthModule>()
    private var lastNonce: Long = 0
    private var bridgeSessionId: String? = null

    private fun errorJson(sanitized: SanitizedError): JSONObject {
        val payload = JSONObject()
            .put("error", sanitized.code)
            .put("message", sanitized.publicMessage)
        if (!sanitized.debugDetails.isNullOrBlank()) {
            payload.put("details", sanitized.debugDetails)
        }
        return payload
    }

    private fun errorMap(sanitized: SanitizedError): Map<String, Any> {
        val payload = mutableMapOf<String, Any>(
            "error" to sanitized.code,
            "message" to sanitized.publicMessage,
        )
        if (!sanitized.debugDetails.isNullOrBlank()) {
            payload["details"] = sanitized.debugDetails
        }
        return payload
    }

    fun setSessionId(sessionId: String) {
        synchronized(this) {
            this.bridgeSessionId = sessionId
        }
    }

    private fun validateNonce(args: ZynthArgs) {
        synchronized(this) {
            val session = bridgeSessionId ?: throw SecurityException("E_INVALID_SESSION: Bridge session not initialized")
            val sessionId = try { args.getString("bridgeSessionId") } catch (e: Exception) { 
                throw SecurityException("E_INVALID_SESSION: Missing bridgeSessionId") 
            }
            val nonce = try { args.getLong("nonce") } catch (e: Exception) {
                throw SecurityException("E_INVALID_NONCE: Missing nonce")
            }

            if (sessionId != session) {
                Log.w(TAG, "Session mismatch: received=$sessionId, expected=$session")
                throw SecurityException("E_INVALID_SESSION: Invalid bridge session")
            }

            if (nonce <= lastNonce) {
                Log.w(TAG, "Replay attack detected: nonce=$nonce, lastNonce=$lastNonce")
                throw SecurityException("E_INVALID_NONCE: Replay attack detected")
            }

            lastNonce = nonce
        }
    }

    fun register(module: ZynthModule) {
        synchronized(this) {
            modules[module.name] = module
        }
        module.initialize()
    }

    fun destroy() {
        val modulesToInvalidate = synchronized(this) {
            val list = modules.values.toList()
            modules.clear()
            list
        }
        modulesToInvalidate.forEach { it.invalidate() }
    }

    fun exportedConstants(): Map<String, Any> {
        val constants = mutableMapOf<String, Any>()
        val currentModules = synchronized(this) {
            modules.values.toList()
        }
        for (module in currentModules) {
            module.constants?.let {
                constants[module.name] = it
            }
        }
        return constants
    }

    fun call(name: String, method: String, args: Array<Any?>): JSONObject {
        val module = synchronized(this) { modules[name] }
        if (module == null) {
            Log.w(TAG, "Module not found: $name")
            val sanitized = ZynthErrorMapper.sanitizeModuleError("module_not_found")
            return errorJson(sanitized)
        }
        if (!module.exportedMethods.contains(method)) {
            Log.w(TAG, "Method not exported: $name.$method")
            val sanitized = ZynthErrorMapper.sanitizeModuleError("method_not_exported")
            return errorJson(sanitized)
        }

        return try {
            val zynthArgs = ZynthArgs(args)
            if (module.protectedMethods.contains(method)) {
                validateNonce(zynthArgs)
            }
            module.call(method, zynthArgs)
        } catch (t: Throwable) {
            val sanitized = ZynthErrorMapper.sanitize(t)
            errorJson(sanitized)
        }
    }

    fun callSync(name: String, method: String, args: Array<Any?>): Any? {
        val module = synchronized(this) { modules[name] }
        if (module == null) {
            val sanitized = ZynthErrorMapper.sanitizeModuleError("module_not_found")
            Log.w(TAG, "Module $name not found")
            return errorMap(sanitized)
        }

        if (module !is ZynthSyncModule) {
            val sanitized = ZynthErrorMapper.sanitizeModuleError("sync_not_supported")
            Log.w(TAG, "Module $name does not support synchronous method $method")
            return errorMap(sanitized)
        }

        if (!module.exportedMethods.contains(method)) {
            val sanitized = ZynthErrorMapper.sanitizeModuleError("method_not_exported")
            Log.w(TAG, "Method $method is not exported by module $name")
            return errorMap(sanitized)
        }

        return try {
            val zynthArgs = ZynthArgs(args)
            if (module.protectedMethods.contains(method)) {
                validateNonce(zynthArgs)
            }
            module.callSync(method, zynthArgs)
        } catch (t: Throwable) {
            val sanitized = ZynthErrorMapper.sanitize(t)
            errorMap(sanitized)
        }
    }
}
