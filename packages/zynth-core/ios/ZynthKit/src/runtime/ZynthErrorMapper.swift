import Foundation

public struct SanitizedError {
    public let code: String
    public let publicMessage: String
}

public final class ZynthErrorMapper {
    public static func sanitize(_ error: Error) -> SanitizedError {
        // Log the full error to native console for debugging
        print("[ZynthErrorMapper] Full native error: \(error)")
        
        #if DEBUG
        let debugSuffix = " (Native: \(error.localizedDescription))"
        #else
        let debugSuffix = ""
        #endif
        
        if let zynthError = error as? ZynthModuleError {
            switch zynthError {
            case .moduleNotFound:
                return SanitizedError(code: "E_MODULE_NOT_FOUND", publicMessage: "The requested module could not be found." + debugSuffix)
            case .syncNotSupported:
                return SanitizedError(code: "E_SYNC_NOT_SUPPORTED", publicMessage: "Synchronous operation is not supported for this method." + debugSuffix)
            case .methodNotExported:
                return SanitizedError(code: "E_METHOD_NOT_FOUND", publicMessage: "The requested method could not be found." + debugSuffix)
            case .runtimeDeallocated:
                return SanitizedError(code: "E_RUNTIME_INVALID", publicMessage: "The runtime has been invalidated." + debugSuffix)
            case .invalidSession:
                return SanitizedError(code: "E_INVALID_SESSION", publicMessage: "The session is invalid or has expired." + debugSuffix)
            case .invalidNonce:
                return SanitizedError(code: "E_INVALID_NONCE", publicMessage: "Security validation failed." + debugSuffix)
            }
        }
        
        // Handle common Cocoa errors if necessary, but keep messages generic
        let nsError = error as NSError
        
        // Handle SecureStore errors specifically if we can identify them (by message or domain)
        let message = error.localizedDescription
        if message.contains("canceled") || message.contains("cancelled") {
            return SanitizedError(code: "E_AUTH_CANCELLED", publicMessage: "Authentication was cancelled." + debugSuffix)
        }
        if message.contains("Auth") || message.contains("biometric") {
            return SanitizedError(code: "E_AUTH_FAILED", publicMessage: "Authentication failed." + debugSuffix)
        }

        if nsError.domain == NSCocoaErrorDomain {
            if nsError.code == NSFileReadNoSuchFileError {
                return SanitizedError(code: "E_FILE_NOT_FOUND", publicMessage: "The file could not be found." + debugSuffix)
            }
            if nsError.code == NSFileWriteNoPermissionError || nsError.code == NSFileReadNoPermissionError {
                return SanitizedError(code: "E_ACCESS_DENIED", publicMessage: "Permission denied." + debugSuffix)
            }
        }

        // Default fallback for any other error
        return SanitizedError(code: "E_NATIVE_ERROR", publicMessage: "An internal native error occurred." + debugSuffix)
    }
}
