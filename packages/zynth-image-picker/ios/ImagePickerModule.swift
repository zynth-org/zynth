import Foundation
import ZynthKit
import UIKit
import AVFoundation
import Photos

private final class DismissAwareImagePickerController: UIImagePickerController {
    var onDismissWithoutCallback: (() -> Void)?
    private var hasAppeared = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        hasAppeared = true
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard hasAppeared else { return }
        if self.isBeingDismissed || self.presentingViewController == nil {
            onDismissWithoutCallback?()
        }
    }
}

public class ImagePickerModule: NSObject, ZynthModule {
    public var name: String { "ImagePicker" }
    private let runtime: ZynthRuntime
    private var pendingRequestId: String?
    private weak var activePicker: DismissAwareImagePickerController?
    private var isCompletingPickerFlow = false

    public var exportedMethods: [String] {
        return [
            "launchCameraAsync",
            "launchImageLibraryAsync",
            "getCameraPermissionsAsync",
            "requestCameraPermissionsAsync",
        ]
    }

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
            throw ZynthModuleError.methodNotExported(module: name, method: method)
        }
    }

    private func getRequestId(_ args: ZynthArgs) -> String {
        return args.string("requestId", default: UUID().uuidString)
    }

    private func beginRequest(_ requestId: String) throws {
        recoverStalePendingRequestIfNeeded()
        if pendingRequestId != nil {
            throw NSError(
                domain: "ZynthImagePicker",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Another request is already pending"]
            )
        }
        pendingRequestId = requestId
        isCompletingPickerFlow = false
    }

    private func recoverStalePendingRequestIfNeeded() {
        guard pendingRequestId != nil else { return }
        if activePicker != nil { return }

        if let top = topMostViewController(), top is UIImagePickerController {
            return
        }

        // Stale state: no picker visible but request still marked pending.
        pendingRequestId = nil
        isCompletingPickerFlow = false
    }

    private func getCameraPermissionsAsync() throws -> [String: Any] {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        var result: [String: Any] = ["canAskAgain": true]

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

        return ["result": result]
    }

    private func requestCameraPermissionsAsync(args: ZynthArgs) throws -> Any? {
        let requestId = getRequestId(args)
        try beginRequest(requestId)

        AVCaptureDevice.requestAccess(for: .video) { granted in
            let status = granted ? "granted" : "denied"
            self.emitResult([
                "status": status,
                "granted": granted,
                "canAskAgain": true,
            ])
        }

        return ["status": "pending"]
    }

    private func launchCameraAsync(args: ZynthArgs) throws -> Any? {
        let requestId = getRequestId(args)
        try beginRequest(requestId)

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
        try beginRequest(requestId)

        DispatchQueue.main.async {
            self.presentPicker(sourceType: .photoLibrary)
        }

        return ["status": "pending"]
    }

    private func presentPicker(sourceType: UIImagePickerController.SourceType) {
        guard UIImagePickerController.isSourceTypeAvailable(sourceType) else {
            emitResult(["error": "Source type not available"])
            return
        }

        let picker = DismissAwareImagePickerController()
        picker.sourceType = sourceType
        picker.delegate = self
        picker.modalTransitionStyle = .coverVertical
        if sourceType == .photoLibrary {
            picker.modalPresentationStyle = .pageSheet
        } else {
            picker.modalPresentationStyle = .fullScreen
        }
        picker.onDismissWithoutCallback = { [weak self] in
            guard let self else { return }
            guard !self.isCompletingPickerFlow else { return }
            self.emitResult(["cancelled": true])
        }

        if #available(iOS 13.0, *) {
            picker.presentationController?.delegate = self
        }

        activePicker = picker

        guard let presenter = topMostViewController() else {
            emitResult(["error": "No root view controller found"])
            return
        }

        presenter.present(picker, animated: true)
    }

    private func topMostViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }

        for scene in scenes {
            if let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController {
                return topViewController(from: root)
            }
            if let root = scene.windows.first?.rootViewController {
                return topViewController(from: root)
            }
        }

        return nil
    }

    private func topViewController(from root: UIViewController) -> UIViewController {
        var current = root
        while let presented = current.presentedViewController {
            current = presented
        }
        return current
    }

    private func emitResult(_ data: [String: Any]) {
        guard let requestId = pendingRequestId else { return }

        activePicker = nil
        isCompletingPickerFlow = false

        var result = data
        result["requestId"] = requestId
        runtime.emitEvent(name: "ImagePicker.result", payload: result)

        pendingRequestId = nil
    }
}

extension ImagePickerModule: UIImagePickerControllerDelegate, UINavigationControllerDelegate, UIAdaptivePresentationControllerDelegate {
    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]
    ) {
        isCompletingPickerFlow = true
        picker.dismiss(animated: true) {
            if let image = info[.originalImage] as? UIImage {
                let fileName = "img_\(Int(Date().timeIntervalSince1970)).jpg"
                let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

                if let data = image.jpegData(compressionQuality: 0.8) {
                    do {
                        try data.write(to: fileURL)
                        self.emitResult([
                            "cancelled": false,
                            "uri": fileURL.absoluteString,
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
        isCompletingPickerFlow = true
        picker.dismiss(animated: true) {
            self.emitResult(["cancelled": true])
        }
    }

    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        guard !isCompletingPickerFlow else { return }
        emitResult(["cancelled": true])
    }
}
