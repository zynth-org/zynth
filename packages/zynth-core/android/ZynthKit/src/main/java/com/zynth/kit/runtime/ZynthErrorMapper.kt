package com.zynth.kit.runtime

import android.content.pm.ApplicationInfo
import android.util.Log
import java.io.PrintWriter
import java.io.StringWriter

data class SanitizedError(
    val code: String,
    val publicMessage: String,
    val debugDetails: String? = null
)

object ZynthErrorMapper {
    private const val TAG = "ZynthErrorMapper"

    private fun isDebuggableApp(): Boolean {
        return try {
            val activityThread = Class.forName("android.app.ActivityThread")
            val method = activityThread.getMethod("currentApplication")
            val application = method.invoke(null) as? android.app.Application
            val flags = application?.applicationInfo?.flags ?: 0
            (flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        } catch (_: Throwable) {
            false
        }
    }

    private fun isDebug(): Boolean {
        return isDebuggableApp() ||
            System.getProperty("ZYNTH_DEBUG") == "true" ||
            System.getProperty("DEBUG") == "true"
    }

    private fun debugDetails(t: Throwable): String? {
        if (!isDebug()) {
            return null
        }
        val writer = StringWriter()
        val printer = PrintWriter(writer)
        t.printStackTrace(printer)
        printer.flush()
        return writer.toString().trim().ifEmpty { t.toString() }
    }

    fun sanitize(t: Throwable): SanitizedError {
        // Log the full error to native console for debugging
        Log.e(TAG, "Full native error: ", t)

        val debugSuffix = if (isDebug()) " (Native: ${t.message})" else ""
        val details = debugDetails(t)

        return when (t) {
            is ZynthTypeException -> {
                SanitizedError("E_TYPE_ERROR", "Invalid arguments passed to native method." + debugSuffix, details)
            }
            is SecurityException -> {
                val msg = t.message ?: ""
                if (msg.contains("E_INVALID_SESSION")) {
                    SanitizedError("E_INVALID_SESSION", "The session is invalid or has expired." + debugSuffix, details)
                } else if (msg.contains("E_INVALID_NONCE")) {
                    SanitizedError("E_INVALID_NONCE", "Security validation failed." + debugSuffix, details)
                } else {
                    SanitizedError("E_ACCESS_DENIED", "Security validation failed." + debugSuffix, details)
                }
            }
            is IllegalStateException -> {
                val msg = t.message ?: ""
                if (msg.contains("cancel", ignoreCase = true)) {
                    SanitizedError("E_AUTH_CANCELLED", "Authentication was cancelled." + debugSuffix, details)
                } else if (msg.contains("auth", ignoreCase = true)) {
                    SanitizedError("E_AUTH_FAILED", "Authentication failed." + debugSuffix, details)
                } else if (msg.contains("TLS is not available", ignoreCase = true)) {
                    SanitizedError("E_TLS_NOT_AVAILABLE", "TLS is not available in this build." + debugSuffix, details)
                } else {
                    SanitizedError("E_NATIVE_ERROR", "An internal native error occurred." + debugSuffix, details)
                }
            }
            is java.io.IOException -> {
                SanitizedError("E_IO_ERROR", "A storage error occurred." + debugSuffix, details)
            }
            // Add more specific exceptions here as they are identified
            else -> {
                // Check message for common patterns if we want to be more specific while staying safe
                val msg = t.message ?: ""
                if (msg.contains("Permission denied", ignoreCase = true)) {
                    SanitizedError("E_ACCESS_DENIED", "Permission denied." + debugSuffix, details)
                } else if (msg.contains("No such file", ignoreCase = true)) {
                    SanitizedError("E_FILE_NOT_FOUND", "The file could not be found." + debugSuffix, details)
                } else {
                    SanitizedError("E_NATIVE_ERROR", "An internal native error occurred." + debugSuffix, details)
                }
            }
        }
    }
    
    fun sanitizeModuleError(type: String): SanitizedError {
        val debugSuffix = if (isDebug()) " (Native: $type)" else ""
        val details = if (isDebug()) "module_error=$type" else null
        return when (type) {
            "module_not_found" -> SanitizedError("E_MODULE_NOT_FOUND", "The requested module could not be found." + debugSuffix, details)
            "method_not_exported" -> SanitizedError("E_METHOD_NOT_FOUND", "The requested method could not be found." + debugSuffix, details)
            "sync_not_supported" -> SanitizedError("E_SYNC_NOT_SUPPORTED", "Synchronous operation is not supported for this method." + debugSuffix, details)
            else -> SanitizedError("E_NATIVE_ERROR", "An internal native error occurred." + debugSuffix, details)
        }
    }
}
