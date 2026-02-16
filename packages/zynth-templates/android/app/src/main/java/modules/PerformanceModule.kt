package {{BUNDLE_ID}}.modules

import com.zynth.kit.debug.PerformanceProfiler
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

import com.zynth.kit.runtime.ZynthModule

class PerformanceModule : ZynthModule, ZynthSyncModule {
    override val name: String = "Performance"

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return JSONObject()
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "getLastFrameStats" -> JSONObject(PerformanceProfiler.getFrameStats()).toString()
            else -> null
        }
    }
}
