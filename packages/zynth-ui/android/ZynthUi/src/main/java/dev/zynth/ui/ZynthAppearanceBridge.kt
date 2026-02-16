package dev.zynth.ui

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

/**
 * Bridge module that exposes appearance state to JavaScript via NativeConstants.
 */
class ZynthAppearanceBridge(
    private val module: ZynthAppearanceModule
) : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthAppearance"

    override val constants: Map<String, Any>?
        get() = module.getInitialState().toMap()

    @Suppress("UNUSED_PARAMETER")
    override fun call(method: String, args: ZynthArgs): JSONObject {
        val params = try { args.nestedAt(0) } catch (e: Exception) { null }
        return JSONObject()
            .put("error", "unsupported_method")
            .put("message", method)
    }

    @Suppress("UNUSED_PARAMETER")
    override fun callSync(method: String, args: ZynthArgs): Any? {
        val params = try { args.nestedAt(0) } catch (e: Exception) { null }
        return when (method) {
            "getCurrent" -> JSONObject(module.getCurrentState().toMap())
            else -> null
        }
    }
}
