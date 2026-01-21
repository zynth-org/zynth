package com.zynth.kit.runtime

import android.util.Log
import org.json.JSONObject

private const val TAG = "ZynthModuleRegistry"

interface ZynthModule {
    val name: String
    val constants: Map<String, Any>?
        get() = null
    fun call(method: String, args: Array<Any?>): JSONObject
    fun initialize() {}
    fun invalidate() {}
}

interface ZynthSyncModule {
    fun callSync(method: String, args: Array<Any?>): Any?
}

class ZynthModuleRegistry {
    private val modules = mutableMapOf<String, ZynthModule>()

    fun register(module: ZynthModule) {
        Log.i(TAG, "Registering module: ${module.name}")
        modules[module.name] = module
        Log.i(TAG, "Module registered. Total modules: ${modules.size}, keys: ${modules.keys}")
        module.initialize()
        Log.i(TAG, "Module initialized: ${module.name}")
    }

    fun destroy() {
        modules.values.forEach { it.invalidate() }
        modules.clear()
    }

    fun exportedConstants(): Map<String, Any> {
        val constants = mutableMapOf<String, Any>()
        for (module in modules.values) {
            module.constants?.let {
                constants[module.name] = it
            }
        }
        return constants
    }

    fun call(name: String, method: String, args: Array<Any?>): JSONObject {
        Log.i(TAG, "call(name=$name, method=$method) - modules.size=${modules.size}")
        Log.i(TAG, "Available modules: ${modules.keys}")
        val module = modules[name]
        if (module == null) {
            Log.w(TAG, "Module not found: $name")
            return JSONObject().put("error", "module_not_found")
        }

        Log.i(TAG, "Module found, calling: $name.$method")
        return try {
            module.call(method, args)
        } catch (t: Throwable) {
            Log.e(TAG, "Exception calling $name.$method", t)
            JSONObject()
                .put("error", "exception")
                .put("message", t.message ?: "unknown")
        }
    }

    fun callSync(name: String, method: String, args: Array<Any?>): Any? {
        Log.i(TAG, "callSync(name=$name, method=$method)")
        val module = modules[name]
            ?: throw IllegalStateException("Module $name not found. Available: ${modules.keys}")

        if (module !is ZynthSyncModule) {
            throw UnsupportedOperationException("Module $name does not support synchronous method $method")
        }

        return module.callSync(method, args)
    }
}
