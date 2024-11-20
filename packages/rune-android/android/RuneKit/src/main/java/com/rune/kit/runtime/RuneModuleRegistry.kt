package com.rune.kit.runtime

interface RuneModule {
  val name: String
  fun call(method: String, argsJson: String): String
}

interface RuneSyncModule {
  fun callSync(method: String, argsJson: String): String?
}

class RuneModuleRegistry {
  private val modules = mutableMapOf<String, RuneModule>()

  fun register(module: RuneModule) {
    modules[module.name] = module
  }

  fun call(name: String, method: String, argsJson: String): String {
    val module = modules[name] ?: return "{\"error\":\"module_not_found\"}"
    return try {
      module.call(method, argsJson)
    } catch (t: Throwable) {
      "{\"error\":\"exception\",\"message\":\"${t.message ?: "unknown"}\"}"
    }
  }

  fun callSync(name: String, method: String, argsJson: String): String? {
    val module = modules[name]
      ?: throw IllegalStateException("Module $name not found")

    if (module !is RuneSyncModule) {
      throw UnsupportedOperationException("Module $name does not support synchronous method $method")
    }

    return module.callSync(method, argsJson)
  }
}
