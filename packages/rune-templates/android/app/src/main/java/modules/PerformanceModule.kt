package {{BUNDLE_ID}}.modules

import com.rune.kit.debug.PerformanceProfiler
import com.rune.kit.runtime.RuneSyncModule
import org.json.JSONObject

import com.rune.kit.runtime.RuneModule

class PerformanceModule : RuneModule, RuneSyncModule {
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
