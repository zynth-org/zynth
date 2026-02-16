import Foundation
import ZynthKit
import UIKit
import AVFoundation
import Photos

public class ImagePickerModule: NSObject, ZynthModule {
    public var name: String { "ImagePicker" }
    private let runtime: ZynthRuntime
    private var pendingRequestId: String?
    
    public init(runtime: ZynthRuntime) {
        self.runtime = runtime
        super.init()
    }
    
    public func call(method: String, args: ZynthArgs) throws -> Any? {
        switch method {
        case "launchCameraAsync":
            return try launchCameraAsync(args: args)
        case "launchImageLibraryAsync":
            return try launchImageLibraryAsync(args: args)
        case "getCameraPermissionsAsync":
            return try getCameraPermissionsAsync()
        case "requestCameraPermissionsAsync":
            return try requestCameraPermissionsAsync(args: args)
        default:
            throw ZynthModuleError.moduleNotFound("Method \(method) not found in ImagePicker module")
        }
    }
    
    private func getRequestId(_ args: ZynthArgs) -> String {
        return args.string("requestId", default: UUID().uuidString)
    }
    
    private func getCameraPermissionsAsync() throws -> [String: Any] {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        var result: [String: Any] = [
            "canAskAgain": true
        ]
        
        switch status {
        case .authorized:
            result["status"] = "granted"
            result["granted"] = true
        case .denied, .restricted:
            result["status"] = "denied"
            result["granted"] = false
        case .notDetermined:
            result["status"] = "undetermined"
            result["granted"] = false
        @unknown default:
            result["status"] = "undetermined"
            result["granted"] = false
        }
        
        return result
    }
    
    private func requestCameraPermissionsAsync(args: ZynthArgs) throws -> Any? {
        let requestId = getRequestId(args)
        self.pendingRequestId = requestId
        
        AVCaptureDevice.requestAccess(for: .video) { granted in
            let status = granted ? "granted" : "denied"
            self.emitResult([
                "status": status,
                "granted": granted,
                "canAskAgain": true
            ])
        }
        
        return ["status": "pending"]
    }
    
    private func launchCameraAsync(args: ZynthArgs) throws -> Any? {
        let requestId = getRequestId(args)
        
        if pendingRequestId != nil {
            return ["error": "Another request is already pending"]
        }
        
        self.pendingRequestId = requestId
        
        DispatchQueue.main.async {
            let status = AVCaptureDevice.authorizationStatus(for: .video)
            if status == .authorized {
                self.presentPicker(sourceType: .camera)
            } else if status == .notDetermined {
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    if granted {
                        DispatchQueue.main.async {
                            self.presentPicker(sourceType: .camera)
                        }
                    } else {
                        self.emitResult(["cancelled": true, "error": "permission_denied"])
                    }
                }
            } else {
                self.emitResult(["cancelled": true, "error": "permission_denied"])
            }
        }
        
        return ["status": "pending"]
    }
    
    private func launchImageLibraryAsync(args: ZynthArgs) throws -> Any? {
        let requestId = getRequestId(args)
        
        if pendingRequestId != nil {
            return ["error": "Another request is already pending"]
        }
        
        self.pendingRequestId = requestId
        
        DispatchQueue.main.async {
            self.presentPicker(sourceType: .photoLibrary)
        }
        
        return ["status": "pending"]
    }
    
    private func presentPicker(sourceType: UIImagePickerController.SourceType) {
        guard UIImagePickerController.isSourceTypeAvailable(sourceType) else {
            self.emitResult(["error": "Source type not available"])
            return
        }
        
        let picker = UIImagePickerController()
        picker.sourceType = sourceType
        picker.delegate = self
        
        if let rootVC = UIApplication.shared.keyWindow?.rootViewController {
            rootVC.present(picker, animated: true)
        } else {
            self.emitResult(["error": "No root view controller found"])
        }
    }
    
    private func emitResult(_ data: [String: Any]) {
        var result = data
        result["requestId"] = self.pendingRequestId
        
        runtime.emitEvent(name: "ImagePicker.result", payload: result)
        
        self.pendingRequestId = nil
    }
}

extension ImagePickerModule: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
        picker.dismiss(animated: true) {
            if let image = info[.originalImage] as? UIImage {
                // Save image to temporary directory to get a file URL
                let fileName = "img_\(Int(Date().timeIntervalSince1970)).jpg"
                let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
                
                if let data = image.jpegData(compressionQuality: 0.8) {
                    do {
                        try data.write(to: fileURL)
                        self.emitResult([
                            "cancelled": false,
                            "uri": fileURL.absoluteString
                        ])
                    } catch {
                        self.emitResult(["error": "Failed to save image: \(error.localizedDescription)"])
                    }
                } else {
                    self.emitResult(["error": "Failed to get JPEG data"])
                }
            } else {
                self.emitResult(["cancelled": true])
            }
        }
    }
    
    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) {
            self.emitResult(["cancelled": true])
        }
    }
}
