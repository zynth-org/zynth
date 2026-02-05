package dev.zynth.automation

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

internal class ZynthAutomationModule(
    private val runtime: ZynthRuntime,
) : ZynthModule, ZynthSyncModule {

    override val name: String = "Automation"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "read" -> JSONObject().put("result", runtime.getUIManager().snapshot(parseOptions(args)))
            else -> JSONObject().put("error", "unknown_method").put("method", method)
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "read" -> runtime.getUIManager().snapshot(parseOptions(args))
            else -> mapOf("error" to "unknown_method", "method" to method)
        }
    }

    private fun parseOptions(args: Array<Any?>): JSONObject? {
        if (args.isEmpty()) return null
        val first = args[0] ?: return null
        return when (first) {
            is JSONObject -> first
            is Map<*, *> -> JSONObject(first)
            else -> null
        }
    }
}
