package dev.rune.imagepicker

import android.Manifest
import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import com.rune.kit.runtime.RuneModule
import com.rune.kit.runtime.RuneRuntime
import org.json.JSONObject
import java.io.File
import java.util.UUID

private const val TAG = "ImagePickerModule"

class ImagePickerModule(
    private val runtime: RuneRuntime,
    private val context: Context
) : RuneModule {
    override val name = "ImagePicker"
    
    // Set by initializer
    var cameraLauncher: ActivityResultLauncher<Uri>? = null
    var permissionLauncher: ActivityResultLauncher<String>? = null
    var imageLibraryLauncher: ActivityResultLauncher<androidx.activity.result.PickVisualMediaRequest>? = null
    
    companion object {
        private var pendingRequestId: String? = null
        private var pendingUri: Uri? = null
    }

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "launchCameraAsync" -> launchCameraAsync(args)
            "launchImageLibraryAsync" -> launchImageLibraryAsync(args)
            "getCameraPermissionsAsync" -> getCameraPermissionsAsync()
            "requestCameraPermissionsAsync" -> requestCameraPermissionsAsync(args)
            else -> JSONObject().put("error", "Unknown method: $method")
        }
    }

    private fun getRequestId(args: Array<Any?>): String {
        val params = args.getOrNull(0)
        return when (params) {
            is JSONObject -> params.optString("requestId", UUID.randomUUID().toString())
            is Map<*, *> -> (params["requestId"] as? String) ?: UUID.randomUUID().toString()
            else -> UUID.randomUUID().toString()
        }
    }

    private fun launchImageLibraryAsync(args: Array<Any?>): JSONObject {
        val requestId = getRequestId(args)
        Log.d(TAG, "launchImageLibraryAsync called with requestId: $requestId")

        if (pendingRequestId != null) {
             return JSONObject().put("error", "Another request is already pending")
        }

        pendingRequestId = requestId

        try {
            if (imageLibraryLauncher == null) {
                emitResult(JSONObject().put("error", "Image library launcher not initialized"))
                return JSONObject().put("status", "error")
            }

            imageLibraryLauncher?.launch(
                androidx.activity.result.PickVisualMediaRequest(
                    ActivityResultContracts.PickVisualMedia.ImageOnly
                )
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch image library", e)
            emitResult(JSONObject().put("error", e.message))
        }

        return JSONObject().put("status", "pending")
    }

    fun onLibraryResult(uri: Uri?) {
        Log.d(TAG, "onLibraryResult: uri=$uri, pendingRequestId=$pendingRequestId")
        if (uri != null) {
            val result = JSONObject()
            result.put("cancelled", false)
            result.put("uri", uri.toString())
            emitResult(result)
        } else {
            Log.d(TAG, "Image picking cancelled")
            emitResult(JSONObject().put("cancelled", true))
        }
    }

    private fun getCameraPermissionsAsync(): JSONObject {
        val permission = Manifest.permission.CAMERA
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(context, permission) == 
            android.content.pm.PackageManager.PERMISSION_GRANTED
        
        return JSONObject().apply {
            put("status", if (granted) "granted" else "undetermined")
            put("granted", granted)
            put("canAskAgain", true)
        }
    }

    private fun requestCameraPermissionsAsync(args: Array<Any?>): JSONObject {
        val requestId = getRequestId(args)
        val permission = Manifest.permission.CAMERA
        
        if (androidx.core.content.ContextCompat.checkSelfPermission(context, permission) == 
            android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return getCameraPermissionsAsync().put("requestId", requestId)
        }

        pendingRequestId = requestId
        Log.d(TAG, "Requesting camera permission for requestId: $requestId")
        permissionLauncher?.launch(permission)
        
        return JSONObject().put("status", "pending")
    }

    private fun launchCameraAsync(args: Array<Any?>): JSONObject {
        val requestId = getRequestId(args)
        Log.d(TAG, "launchCameraAsync called with requestId: $requestId")

        if (pendingRequestId != null) {
             Log.w(TAG, "Another request is already pending: $pendingRequestId")
             return JSONObject().put("error", "Another request is already pending")
        }

        pendingRequestId = requestId
        val permission = Manifest.permission.CAMERA
        
        if (androidx.core.content.ContextCompat.checkSelfPermission(context, permission) 
            == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            Log.d(TAG, "Permission not granted, requesting for camera...")
            permissionLauncher?.launch(permission)
        }

        return JSONObject().put("status", "pending")
    }

    fun onPermissionResult(isGranted: Boolean) {
        Log.d(TAG, "onPermissionResult: granted=$isGranted, pendingRequestId=$pendingRequestId")
        if (pendingRequestId == null) return

        if (isGranted) {
            // Check if this was a direct permission request or part of launchCamera
            // For now we assume if it was part of launchCamera we want to start camera
            // If it was just a permission request, we just emit the result
            if (pendingUri == null) {
                // If pendingUri is null, we haven't started startCamera yet
                // But wait, launchCameraAsync sets pendingRequestId then checks permission.
                // If it calls permissionLauncher, it HASN'T called startCamera yet.
                // We need to know if we should proceed to camera or just return permission status.
                startCamera()
            } else {
                // This state shouldn't really happen with current logic but handle it
                emitResult(getCameraPermissionsAsync())
            }
        } else {
            emitResult(JSONObject().put("cancelled", true).put("error", "permission_denied"))
        }
    }

    private fun startCamera() {
        try {
            val file = File(context.cacheDir, "rune_images")
            if (!file.exists()) file.mkdirs()
            
            val imageFile = File(file, "img_${System.currentTimeMillis()}.jpg")
            
            // Generate URI using FileProvider
            val authority = "${context.packageName}.rune.imagepicker.provider"
            val uri = FileProvider.getUriForFile(context, authority, imageFile)
            
            pendingUri = uri
            Log.d(TAG, "Starting camera intent. URI: $uri")
            
            if (cameraLauncher == null) {
                Log.e(TAG, "cameraLauncher is NULL!")
                emitResult(JSONObject().put("error", "Camera launcher not initialized"))
                return
            }
            
            cameraLauncher?.launch(uri)
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start camera", e)
            emitResult(JSONObject().put("error", e.message))
        }
    }

    fun onCameraResult(success: Boolean) {
        Log.d(TAG, "onCameraResult: success=$success, pendingUri=$pendingUri, pendingRequestId=$pendingRequestId")
        if (success && pendingUri != null) {
            val result = JSONObject()
            result.put("cancelled", false)
            result.put("uri", pendingUri.toString())
            emitResult(result)
        } else {
            Log.d(TAG, "Camera cancelled or failed")
            emitResult(JSONObject().put("cancelled", true))
        }
    }

    private fun emitResult(data: JSONObject) {
        val requestId = pendingRequestId
        Log.d(TAG, "emitResult: requestId=$requestId, data=$data")
        
        data.put("requestId", requestId)
        runtime.emitEvent("ImagePicker.result", data)
        
        // Reset state
        pendingRequestId = null
        pendingUri = null
    }
}
