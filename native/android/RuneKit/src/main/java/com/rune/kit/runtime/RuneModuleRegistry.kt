package com.rune.kit.runtime

interface RuneModule {
  val name: String
  fun call(method: String, argsJson: String): String
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
}
