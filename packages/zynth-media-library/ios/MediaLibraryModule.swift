import Foundation
import Photos
import UIKit
import ZynthKit

@objc(MediaLibraryModule)
final class MediaLibraryModule: NSObject, ZynthModule {
  let name: String = "MediaLibrary"

  var exportedMethods: [String] {
    ["getPermissionsAsync", "requestPermissionsAsync", "saveImageAsync", "saveVideoAsync"]
  }

  private weak var runtime: ZynthRuntime?

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getPermissionsAsync":
      return getPermissionsAsync(args: args)
    case "requestPermissionsAsync":
      return requestPermissionsAsync(args: args)
    case "saveImageAsync":
      return try saveMediaAsync(args: args, asVideo: false)
    case "saveVideoAsync":
      return try saveMediaAsync(args: args, asVideo: true)
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func getPermissionsAsync(args: ZynthArgs) -> [String: Any] {
    let writeOnly = args.bool("writeOnly", default: true)
    let accessLevel: PHAccessLevel = writeOnly ? .addOnly : .readWrite
    let status = PHPhotoLibrary.authorizationStatus(for: accessLevel)
    return permissionResponse(status)
  }

  private func requestPermissionsAsync(args: ZynthArgs) -> [String: Any] {
    let writeOnly = args.bool("writeOnly", default: true)
    let accessLevel: PHAccessLevel = writeOnly ? .addOnly : .readWrite

    let semaphore = DispatchSemaphore(value: 0)
    var response = permissionResponse(PHPhotoLibrary.authorizationStatus(for: accessLevel))

    PHPhotoLibrary.requestAuthorization(for: accessLevel) { status in
      response = self.permissionResponse(status)
      semaphore.signal()
    }

    _ = semaphore.wait(timeout: .now() + 30)
    return response
  }

  private func saveMediaAsync(args: ZynthArgs, asVideo: Bool) throws -> [String: Any] {
    let status = requestPermissionsAsync(args: args)
    let granted = (status["granted"] as? Bool) == true
    if !granted {
      throw NSError(domain: "ZynthMediaLibrary", code: 1, userInfo: [NSLocalizedDescriptionKey: "Photo library permission is not granted"])
    }

    let rawUri = try args.string("uri")
    let url = try resolveFileURL(rawUri)

    let semaphore = DispatchSemaphore(value: 0)
    var saveError: Error?

    PHPhotoLibrary.shared().performChanges({
      if asVideo {
        PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
      } else {
        PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url)
      }
    }, completionHandler: { _, error in
      saveError = error
      semaphore.signal()
    })

    _ = semaphore.wait(timeout: .now() + 30)

    if let saveError {
      throw saveError
    }

    return ["uri": rawUri]
  }

  private func resolveFileURL(_ raw: String) throws -> URL {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw NSError(domain: "ZynthMediaLibrary", code: 2, userInfo: [NSLocalizedDescriptionKey: "URI cannot be empty"])
    }

    let candidate: URL
    if let url = URL(string: trimmed), let scheme = url.scheme, !scheme.isEmpty {
      if scheme.lowercased() == "file" {
        candidate = url
      } else {
        throw NSError(domain: "ZynthMediaLibrary", code: 3, userInfo: [NSLocalizedDescriptionKey: "Only file:// URIs are supported"])
      }
    } else {
      candidate = URL(fileURLWithPath: trimmed)
    }

    let resolved = candidate.resolvingSymlinksInPath().standardizedFileURL
    let homeDir = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
      .resolvingSymlinksInPath()
      .standardizedFileURL
    guard resolved.path == homeDir.path || resolved.path.hasPrefix(homeDir.path + "/") else {
      throw NSError(domain: "ZynthMediaLibrary", code: 4, userInfo: [NSLocalizedDescriptionKey: "File is outside app sandbox"])
    }

    var isDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
      throw NSError(domain: "ZynthMediaLibrary", code: 5, userInfo: [NSLocalizedDescriptionKey: "File does not exist"])
    }

    return resolved
  }

  private func permissionResponse(_ status: PHAuthorizationStatus) -> [String: Any] {
    switch status {
    case .authorized, .limited:
      return ["status": "granted", "granted": true, "canAskAgain": true]
    case .denied, .restricted:
      return ["status": "denied", "granted": false, "canAskAgain": false]
    case .notDetermined:
      fallthrough
    @unknown default:
      return ["status": "undetermined", "granted": false, "canAskAgain": true]
    }
  }
}
