package com.rune.hypervisor

import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject

class RuneHypervisorModule(
    private val runtime: RuneRuntime,
    private val onMessage: (Any?) -> Unit
) : RuneModule {
    override val name = "RuneHypervisor"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "postMessage" -> {
                val message = args.firstOrNull()
                onMessage(message)
                JSONObject()
            }
            else -> JSONObject().put("error", "unknown_method").put("method", method)
        }
    }
}
