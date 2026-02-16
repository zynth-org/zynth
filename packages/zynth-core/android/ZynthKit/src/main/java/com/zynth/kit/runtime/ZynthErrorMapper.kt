package com.zynth.kit.runtime

import android.util.Log

data class SanitizedError(
    val code: String,
    val publicMessage: String
)

object ZynthErrorMapper {
    private const val TAG = "ZynthErrorMapper"

    private fun isDebug(): Boolean {
        return System.getProperty("ZYNTH_DEBUG") == "true" || 
               System.getProperty("DEBUG") == "true"
    }

    fun sanitize(t: Throwable): SanitizedError {
        // Log the full error to native console for debugging
        Log.e(TAG, "Full native error: ", t)

        val debugSuffix = if (isDebug()) " (Native: ${t.message})" else ""

        return when (t) {
            is ZynthTypeException -> {
                SanitizedError("E_TYPE_ERROR", "Invalid arguments passed to native method." + debugSuffix)
            }
            is SecurityException -> {
                val msg = t.message ?: ""
                if (msg.contains("E_INVALID_SESSION")) {
                    SanitizedError("E_INVALID_SESSION", "The session is invalid or has expired." + debugSuffix)
                } else if (msg.contains("E_INVALID_NONCE")) {
                    SanitizedError("E_INVALID_NONCE", "Security validation failed." + debugSuffix)
                } else {
                    SanitizedError("E_ACCESS_DENIED", "Security validation failed." + debugSuffix)
                }
            }
            is IllegalStateException -> {
                val msg = t.message ?: ""
                if (msg.contains("cancel", ignoreCase = true)) {
                    SanitizedError("E_AUTH_CANCELLED", "Authentication was cancelled." + debugSuffix)
                } else if (msg.contains("auth", ignoreCase = true)) {
                    SanitizedError("E_AUTH_FAILED", "Authentication failed." + debugSuffix)
                } else {
                    SanitizedError("E_NATIVE_ERROR", "An internal native error occurred." + debugSuffix)
                }
            }
            // Add more specific exceptions here as they are identified
            else -> {
                // Check message for common patterns if we want to be more specific while staying safe
                val msg = t.message ?: ""
                if (msg.contains("Permission denied", ignoreCase = true)) {
                    SanitizedError("E_ACCESS_DENIED", "Permission denied." + debugSuffix)
                } else if (msg.contains("No such file", ignoreCase = true)) {
                    SanitizedError("E_FILE_NOT_FOUND", "The file could not be found." + debugSuffix)
                } else {
                    SanitizedError("E_NATIVE_ERROR", "An internal native error occurred." + debugSuffix)
                }
            }
        }
    }
    
    fun sanitizeModuleError(type: String): SanitizedError {
        val debugSuffix = if (isDebug()) " (Native: $type)" else ""
        return when (type) {
            "module_not_found" -> SanitizedError("E_MODULE_NOT_FOUND", "The requested module could not be found." + debugSuffix)
            "method_not_exported" -> SanitizedError("E_METHOD_NOT_FOUND", "The requested method could not be found." + debugSuffix)
            "sync_not_supported" -> SanitizedError("E_SYNC_NOT_SUPPORTED", "Synchronous operation is not supported for this method." + debugSuffix)
            else -> SanitizedError("E_NATIVE_ERROR", "An internal native error occurred." + debugSuffix)
        }
    }
}
