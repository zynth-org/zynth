package dev.zynth.imagepicker

import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.zynth.kit.runtime.ZynthRuntime
import java.lang.ref.WeakReference

object ZynthImagePicker {
    private const val TAG = "ZynthImagePicker"
    
    @JvmStatic
    fun initialize(activity: ComponentActivity, runtime: ZynthRuntime) {
        Log.d(TAG, "Initializing ZynthImagePicker")
        
        val module = ImagePickerModule(runtime, activity)
        
        // Register launchers
        // Note: This MUST be called before the activity is started (ON_CREATE)
        // Since initialize is called from MainActivity.onCreate, we are good.
        
        module.cameraLauncher = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
            module.onCameraResult(success)
        }
        
        module.permissionLauncher = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
            module.onPermissionResult(isGranted)
        }

        module.imageLibraryLauncher = activity.registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            module.onLibraryResult(uri)
        }
        
        runtime.installModules(listOf(module))
        Log.d(TAG, "ZynthImagePicker initialized")
    }
}
