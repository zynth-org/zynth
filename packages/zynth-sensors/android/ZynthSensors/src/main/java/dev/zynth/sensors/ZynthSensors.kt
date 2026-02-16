package dev.zynth.sensors

import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import com.zynth.kit.runtime.ZynthRuntime

object ZynthSensors {
    private const val TAG = "ZynthSensors"
    private var moduleInstance: SensorsModule? = null

    @JvmStatic
    fun initialize(activity: ComponentActivity, runtime: ZynthRuntime) {
        if (moduleInstance != null) {
            Log.w(TAG, "Module already initialized")
            return
        }

        val module = SensorsModule(runtime, activity)
        val permissionLauncher: ActivityResultLauncher<String> =
            activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                module.onPermissionResult(granted)
            }

        module.permissionLauncher = permissionLauncher
        moduleInstance = module

        runtime.installModules(listOf(module))
        Log.d(TAG, "Module initialized")
    }

    @JvmStatic
    fun cleanup() {
        moduleInstance?.invalidate()
        moduleInstance = null
    }
}
