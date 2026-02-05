package dev.zynth.automation

import android.content.pm.ApplicationInfo
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

internal class ZynthAutomationModule(
    private val runtime: ZynthRuntime,
) : ZynthModule, ZynthSyncModule {

    override val name: String = "Automation"
    private var productionInspectionEnabled: Boolean = false

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "read" -> JSONObject().put("result", runtime.getUIManager().snapshot(normalizedReadOptions(args)))
            "configure" -> JSONObject().put("result", configure(args))
            else -> JSONObject().put("error", "unknown_method").put("method", method)
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "read" -> runtime.getUIManager().snapshot(normalizedReadOptions(args))
            "configure" -> JSONObject(configure(args))
            else -> JSONObject().put("error", "unknown_method").put("method", method)
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

    private fun configure(args: Array<Any?>): Map<String, Any> {
        val options = parseOptions(args)
        productionInspectionEnabled = options?.optBoolean("enableProductionInspection", false) ?: false
        return mapOf("productionInspectionEnabled" to productionInspectionEnabled)
    }

    private fun normalizedReadOptions(args: Array<Any?>): JSONObject {
        val options = parseOptions(args) ?: JSONObject()
        if (!isDebugBuild() && !productionInspectionEnabled) {
            // Heavy fields are disabled in production by default to reduce overhead.
            options.put("includeResolvedStyles", false)
            options.put("includeComponentState", false)
            options.put("includeText", false)
        }
        return options
    }

    private fun isDebugBuild(): Boolean {
        val flags = runtime.root.context.applicationInfo.flags
        return (flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }
}
