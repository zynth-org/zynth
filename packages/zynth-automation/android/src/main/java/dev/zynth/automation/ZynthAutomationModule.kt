package dev.zynth.automation

import android.content.pm.ApplicationInfo
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

internal class ZynthAutomationModule(
    private val runtime: ZynthRuntime,
) : ZynthModule, ZynthSyncModule {

    override val name: String = "Automation"
    private var productionInspectionEnabled: Boolean = false

    override val exportedMethods: List<String> = listOf("read", "configure")
    override val protectedMethods: List<String> = listOf("read", "configure")

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "read" -> JSONObject().put("result", runtime.getUIManager().snapshot(normalizedReadOptions(args)))
            "configure" -> JSONObject().put("result", JSONObject(configure(args)))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "read" -> runtime.getUIManager().snapshot(normalizedReadOptions(args))
            "configure" -> configure(args)
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun parseOptions(args: ZynthArgs): JSONObject {
        return try {
            JSONObject(args.getMapAt(0))
        } catch (e: Exception) {
            JSONObject()
        }
    }

    private fun configure(args: ZynthArgs): Map<String, Any> {
        val options = parseOptions(args)
        productionInspectionEnabled = options.optBoolean("enableProductionInspection", false)
        return mapOf("productionInspectionEnabled" to productionInspectionEnabled)
    }

    private fun normalizedReadOptions(args: ZynthArgs): JSONObject {
        val options = parseOptions(args)
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
