import Foundation
import UniformTypeIdentifiers
import UIKit
import ZynthKit

@objc(DocumentPickerModule)
final class DocumentPickerModule: NSObject, ZynthModule, UIDocumentPickerDelegate {
  let name: String = "DocumentPicker"

  private let runtime: ZynthRuntime
  private var pendingRequestId: String?
  private var pendingCopyToCacheDirectory = true

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "pickDocumentAsync":
      return try pickDocumentAsync(args: args)
    default:
      return errorResponse("unsupported_method", method)
    }
  }

  private func pickDocumentAsync(args: Any?) throws -> Any? {
    if pendingRequestId != nil {
      return errorResponse("busy", "Another picker request is already active")
    }

    let requestId = getRequestId(args)
    let options = getOptions(args)
    pendingRequestId = requestId
    pendingCopyToCacheDirectory = options.copyToCacheDirectory

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }

      guard let presenter = self.topViewController() else {
        self.emitResult([
          "error": "No active view controller to present DocumentPicker",
          "cancelled": true,
        ])
        return
      }

      let contentTypes = self.resolveContentTypes(options.types)
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: contentTypes,
        asCopy: options.copyToCacheDirectory
      )
      picker.allowsMultipleSelection = options.multiple
      picker.delegate = self
      presenter.present(picker, animated: true)
    }

    return ["status": "pending"]
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    emitResult([
      "cancelled": true,
      "assets": [],
    ])
  }

  func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    let assets = urls.compactMap { buildAsset(from: $0) }
    emitResult([
      "cancelled": false,
      "assets": assets,
    ])
  }

  private func buildAsset(from url: URL) -> [String: Any]? {
    let accessed = url.startAccessingSecurityScopedResource()
    defer {
      if accessed {
        url.stopAccessingSecurityScopedResource()
      }
    }

    let finalURL: URL
    if pendingCopyToCacheDirectory {
      do {
        finalURL = try copyToCache(url)
      } catch {
        return [
          "uri": url.absoluteString,
          "name": url.lastPathComponent,
          "mimeType": mimeType(for: url) ?? NSNull(),
          "size": NSNull(),
        ]
      }
    } else {
      finalURL = url
    }

    let resourceValues = try? finalURL.resourceValues(forKeys: [.fileSizeKey, .nameKey])
    let fileSize = resourceValues?.fileSize
    let fileName = resourceValues?.name ?? finalURL.lastPathComponent

    return [
      "uri": finalURL.absoluteString,
      "name": fileName.isEmpty ? NSNull() : fileName,
      "mimeType": mimeType(for: finalURL) ?? NSNull(),
      "size": fileSize ?? NSNull(),
    ]
  }

  private func copyToCache(_ sourceURL: URL) throws -> URL {
    let cacheDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent("zynth-document-picker", isDirectory: true)
    try FileManager.default.createDirectory(
      at: cacheDir,
      withIntermediateDirectories: true,
      attributes: nil
    )

    let fileName = sourceURL.lastPathComponent.isEmpty ? "document" : sourceURL.lastPathComponent
    let destination = cacheDir.appendingPathComponent("\(UUID().uuidString)-\(fileName)")
    try FileManager.default.copyItem(at: sourceURL, to: destination)
    return destination
  }

  private func mimeType(for url: URL) -> String? {
    if let type = UTType(filenameExtension: url.pathExtension.lowercased()) {
      return type.preferredMIMEType
    }
    return nil
  }

  private func resolveContentTypes(_ rawTypes: [String]) -> [UTType] {
    if rawTypes.isEmpty {
      return [.item]
    }

    var result: [UTType] = []
    for raw in rawTypes {
      let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty || trimmed == "*/*" {
        result.append(.item)
        continue
      }
      if let type = UTType(mimeType: trimmed) {
        result.append(type)
        continue
      }
      if let type = UTType(trimmed) {
        result.append(type)
      }
    }

    return result.isEmpty ? [.item] : result
  }

  private func topViewController(base: UIViewController? = nil) -> UIViewController? {
    let start: UIViewController?
    if let base {
      start = base
    } else {
      start = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .first(where: { $0.isKeyWindow })?
        .rootViewController
    }

    if let nav = start as? UINavigationController {
      return topViewController(base: nav.visibleViewController)
    }
    if let tab = start as? UITabBarController {
      return topViewController(base: tab.selectedViewController)
    }
    if let presented = start?.presentedViewController {
      return topViewController(base: presented)
    }
    return start
  }

  private func getRequestId(_ args: Any?) -> String {
    guard
      let payload = getDictArg(args),
      let value = payload["requestId"] as? String,
      !value.isEmpty
    else {
      return UUID().uuidString
    }
    return value
  }

  private typealias PickerOptions = (multiple: Bool, types: [String], copyToCacheDirectory: Bool)

  private func getOptions(_ args: Any?) -> PickerOptions {
    let optionsMap = getOptionsMap(args)
    let multiple = optionsMap["multiple"] as? Bool ?? false
    let copyToCacheDirectory = optionsMap["copyToCacheDirectory"] as? Bool ?? true
    let types = normalizeTypes(optionsMap["type"])
    return (multiple: multiple, types: types, copyToCacheDirectory: copyToCacheDirectory)
  }

  private func getOptionsMap(_ args: Any?) -> [String: Any] {
    guard let payload = getDictArg(args) else {
      return [:]
    }

    if let options = payload["options"] as? [String: Any] {
      return options
    }
    if let options = payload["options"] as? NSDictionary {
      return options as? [String: Any] ?? [:]
    }
    return [:]
  }

  private func normalizeTypes(_ raw: Any?) -> [String] {
    if let value = raw as? String {
      return [value]
    }
    if let values = raw as? [String] {
      return values
    }
    if let values = raw as? [Any] {
      return values.compactMap { $0 as? String }
    }
    return []
  }

  private func unwrapArgs(_ args: Any?) -> Any? {
    if let array = args as? [Any], array.count == 1 {
      let value = array[0]
      return value is NSNull ? nil : value
    }
    return args
  }

  private func getDictArg(_ args: Any?) -> [String: Any]? {
    let unwrapped = unwrapArgs(args)
    if let dict = unwrapped as? [String: Any] {
      return dict
    }
    if let dict = unwrapped as? NSDictionary {
      return dict as? [String: Any]
    }
    return nil
  }

  private func emitResult(_ payload: [String: Any]) {
    var data = payload
    data["requestId"] = pendingRequestId
    runtime.emitEvent(name: "DocumentPicker.result", payload: data)
    pendingRequestId = nil
    pendingCopyToCacheDirectory = true
  }

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    return ["error": error, "message": message]
  }
}
