package dev.rune.imagepicker

import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.rune.kit.runtime.RuneRuntime
import java.lang.ref.WeakReference

object RuneImagePicker {
    private const val TAG = "RuneImagePicker"
    
    @JvmStatic
    fun initialize(activity: ComponentActivity, runtime: RuneRuntime) {
        Log.d(TAG, "Initializing RuneImagePicker")
        
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
        Log.d(TAG, "RuneImagePicker initialized")
    }
}
