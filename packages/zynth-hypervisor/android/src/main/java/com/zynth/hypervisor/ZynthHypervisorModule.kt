package com.zynth.hypervisor

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import org.json.JSONObject

class ZynthHypervisorModule(
    private val runtime: ZynthRuntime,
    private val onMessage: (Any?) -> Unit
) : ZynthModule {
    override val name = "ZynthHypervisor"

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
