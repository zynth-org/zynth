package dev.zynth.markdown

import android.app.Activity
import android.util.Log
import com.zynth.kit.runtime.ZynthRuntime

/**
 * Public interface for ZynthMarkdown module.
 */
object ZynthMarkdown {
    private var moduleInstance: ZynthMarkdownModule? = null

    @JvmStatic
    fun initialize(activity: Activity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            Log.w("ZynthMarkdown", "Module already initialized")
            return
        }

        moduleInstance = ZynthMarkdownModule()
        runtime.installModules(listOf(moduleInstance!!))
        Log.d("ZynthMarkdown", "Module initialized")
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance = null
    }
}
