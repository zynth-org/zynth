package dev.zynth.fileintents

import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.zynth.kit.runtime.ZynthRuntime

object ZynthFileIntents {
    private const val TAG = "ZynthFileIntents"

    @JvmStatic
    fun initialize(activity: ComponentActivity, runtime: ZynthRuntime) {
        Log.d(TAG, "Initializing ZynthFileIntents")

        val module = FileIntentsModule(runtime, activity)
        module.exportLauncher =
            activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                module.onExportResult(result)
            }

        runtime.installModules(listOf(module))
        Log.d(TAG, "ZynthFileIntents initialized")
    }
}
