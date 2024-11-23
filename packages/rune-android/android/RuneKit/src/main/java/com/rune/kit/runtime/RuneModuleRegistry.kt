package com.rune.kit.runtime

import org.json.JSONObject

interface RuneModule {
    val name: String
    fun call(method: String, args: Array<Any?>): JSONObject
}

interface RuneSyncModule {
    fun callSync(method: String, args: Array<Any?>): Any?
}

class RuneModuleRegistry {
    private val modules = mutableMapOf<String, RuneModule>()

    fun register(module: RuneModule) {
        modules[module.name] = module
    }

    fun call(name: String, method: String, args: Array<Any?>): JSONObject {
        val module = modules[name]
            ?: return JSONObject().put("error", "module_not_found")

        return try {
            module.call(method, args)
        } catch (t: Throwable) {
            JSONObject()
                .put("error", "exception")
                .put("message", t.message ?: "unknown")
        }
    }

    fun callSync(name: String, method: String, args: Array<Any?>): Any? {
        val module = modules[name]
            ?: throw IllegalStateException("Module $name not found")

        if (module !is RuneSyncModule) {
            throw UnsupportedOperationException("Module $name does not support synchronous method $method")
        }

        return module.callSync(method, args)
    }
}
