package {{BUNDLE_ID}}.modules

import com.zynth.kit.debug.PerformanceProfiler
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

import com.zynth.kit.runtime.ZynthModule

class PerformanceModule : ZynthModule, ZynthSyncModule {
    override val name: String = "Performance"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return JSONObject()
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "getLastFrameStats" -> JSONObject(PerformanceProfiler.getFrameStats()).toString()
            else -> null
        }
    }
}
