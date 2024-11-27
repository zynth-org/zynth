package com.rune.kit.runtime

import org.json.JSONObject

interface RuneModule {
    val name: String
    val constants: Map<String, Any>?
        get() = null
    fun call(method: String, args: Array<Any?>): JSONObject
    fun initialize() {}
    fun invalidate() {}
}

interface RuneSyncModule {
    fun callSync(method: String, args: Array<Any?>): Any?
}

class RuneModuleRegistry {
    private val modules = mutableMapOf<String, RuneModule>()

    fun register(module: RuneModule) {
        modules[module.name] = module
        module.initialize()
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
