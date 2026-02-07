package dev.zynth.documentpicker

import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.zynth.kit.runtime.ZynthRuntime

object ZynthDocumentPicker {
    private const val TAG = "ZynthDocumentPicker"

    @JvmStatic
    fun initialize(activity: ComponentActivity, runtime: ZynthRuntime) {
        Log.d(TAG, "Initializing ZynthDocumentPicker")

        val module = DocumentPickerModule(runtime, activity)

        module.openDocumentLauncher =
            activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                module.onSingleDocumentResult(uri)
            }

        module.openMultipleDocumentsLauncher =
            activity.registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
                module.onMultipleDocumentsResult(uris)
            }

        runtime.installModules(listOf(module))
        Log.d(TAG, "ZynthDocumentPicker initialized")
    }
}
