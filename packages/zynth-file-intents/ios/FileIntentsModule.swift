import Foundation
import UIKit
import UniformTypeIdentifiers
import ZynthKit

@objc(FileIntentsModule)
final class FileIntentsModule: NSObject, ZynthModule, UIDocumentPickerDelegate, UIDocumentInteractionControllerDelegate, UIAdaptivePresentationControllerDelegate {
  let name: String = "FileIntents"

  var exportedMethods: [String] {
    ["openAsync", "shareAsync", "exportAsync"]
  }

  private weak var runtime: ZynthRuntime?
  private var pendingExportRequestId: String?
  private var interactionController: UIDocumentInteractionController?

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "openAsync":
      return try onMainSync { try openAsync(args: args) }
    case "shareAsync":
      return try onMainSync { try shareAsync(args: args) }
    case "exportAsync":
      return try onMainSync { try exportAsync(args: args) }
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func openAsync(args: ZynthArgs) throws -> Any? {
    let uri = try args.string("uri")
    let url = try resolveFileURL(uri)
    guard let presenter = topViewController() else {
      throw NSError(domain: "ZynthFileIntents", code: 1, userInfo: [NSLocalizedDescriptionKey: "No active view controller"]) }

    let controller = UIDocumentInteractionController(url: url)
    controller.delegate = self
    interactionController = controller

    if !controller.presentOptionsMenu(from: presenter.view.bounds, in: presenter.view, animated: true) {
      if UIApplication.shared.canOpenURL(url) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
      } else {
        throw NSError(domain: "ZynthFileIntents", code: 2, userInfo: [NSLocalizedDescriptionKey: "No app available to open file"])
      }
    }

    return ["opened": true]
  }

  private func shareAsync(args: ZynthArgs) throws -> Any? {
    let payload = (try? args.asDict()) ?? [:]
    let files = normalizeFiles(payload["files"]) 
    let text = payload["text"] as? String
    let subject = payload["subject"] as? String

    var items: [Any] = files
    if let text, !text.isEmpty {
      items.append(text)
    }

    if items.isEmpty {
      throw NSError(domain: "ZynthFileIntents", code: 3, userInfo: [NSLocalizedDescriptionKey: "shareAsync requires at least one file or text"])
    }

    guard let presenter = topViewController() else {
      throw NSError(domain: "ZynthFileIntents", code: 1, userInfo: [NSLocalizedDescriptionKey: "No active view controller"])
    }

    let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
    if let subject, !subject.isEmpty {
      activity.setValue(subject, forKey: "subject")
    }
    presenter.present(activity, animated: true)

    return ["shared": true]
  }

  private func exportAsync(args: ZynthArgs) throws -> Any? {
    if pendingExportRequestId != nil {
      throw NSError(domain: "ZynthFileIntents", code: 4, userInfo: [NSLocalizedDescriptionKey: "Another export request is already active"]) }

    let requestId = args.string("requestId", default: UUID().uuidString)
    let uri = try args.string("uri")
    let suggestedName = args.optionalString("suggestedName")
    let requestedTarget = args.string("target", default: "files").lowercased()
    let target = requestedTarget == "downloads" ? "files" : requestedTarget
    guard target == "files" else {
      throw NSError(domain: "ZynthFileIntents", code: 5, userInfo: [NSLocalizedDescriptionKey: "iOS export target must be 'files' or 'downloads'"]) }

    let sourceURL = try resolveFileURL(uri)
    let exportURL = try prepareExportURL(sourceURL: sourceURL, suggestedName: suggestedName)
    pendingExportRequestId = requestId

    DispatchQueue.main.async { [weak self] in
      self?.presentExportPicker(requestId: requestId, exportURL: exportURL)
    }

    return ["status": "pending"]
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    emitExportResult(cancelled: true, destinationUri: nil, error: nil)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let destination = urls.first?.absoluteString
    emitExportResult(cancelled: false, destinationUri: destination, error: nil)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    emitExportResult(cancelled: true, destinationUri: nil, error: nil)
  }

  private func emitExportResult(cancelled: Bool, destinationUri: String?, error: String?) {
    let requestId = pendingExportRequestId
    pendingExportRequestId = nil
    guard let requestId else { return }

    let payload: [String: Any] = [
      "requestId": requestId,
      "cancelled": cancelled,
      "destinationUri": (destinationUri as Any?) ?? NSNull(),
      "error": (error as Any?) ?? NSNull(),
    ]
    runtime?.emitEvent(name: "FileIntents.result", payload: payload)
  }

  private func presentExportPicker(requestId: String, exportURL: URL) {
    guard pendingExportRequestId == requestId else {
      return
    }

    guard let presenter = topViewController() else {
      emitExportResult(
        cancelled: false,
        destinationUri: nil,
        error: "No active view controller"
      )
      return
    }

    let picker = UIDocumentPickerViewController(forExporting: [exportURL], asCopy: true)
    picker.delegate = self
    picker.modalPresentationStyle = .formSheet
    picker.presentationController?.delegate = self
    presenter.present(picker, animated: true)
  }

  private func normalizeFiles(_ raw: Any?) -> [URL] {
    guard let list = raw as? [Any] else { return [] }
    return list.compactMap { item in
      guard let record = item as? [String: Any], let uri = record["uri"] as? String else {
        return nil
      }
      return try? resolveFileURL(uri)
    }
  }

  private func prepareExportURL(sourceURL: URL, suggestedName: String?) throws -> URL {
    let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent("zynth-file-intents", isDirectory: true)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

    let baseName = (suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
      ? suggestedName!
      : sourceURL.lastPathComponent
    let safeName = baseName.replacingOccurrences(of: "[^a-zA-Z0-9._-]", with: "_", options: .regularExpression)
    let destination = tempDir.appendingPathComponent("\(UUID().uuidString)-\(safeName)")

    if FileManager.default.fileExists(atPath: destination.path) {
      try? FileManager.default.removeItem(at: destination)
    }
    try FileManager.default.copyItem(at: sourceURL, to: destination)
    return destination
  }

  private func resolveFileURL(_ raw: String) throws -> URL {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw NSError(domain: "ZynthFileIntents", code: 6, userInfo: [NSLocalizedDescriptionKey: "URI cannot be empty"])
    }

    let candidate: URL
    if let url = URL(string: trimmed), let scheme = url.scheme, !scheme.isEmpty {
      if scheme.lowercased() == "file" {
        candidate = url
      } else {
        throw NSError(domain: "ZynthFileIntents", code: 7, userInfo: [NSLocalizedDescriptionKey: "Only file:// URIs are supported on iOS"])
      }
    } else {
      candidate = URL(fileURLWithPath: trimmed)
    }

    let resolved = candidate.resolvingSymlinksInPath().standardizedFileURL
    let homeDir = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
      .resolvingSymlinksInPath()
      .standardizedFileURL
    guard resolved.path == homeDir.path || resolved.path.hasPrefix(homeDir.path + "/") else {
      throw NSError(domain: "ZynthFileIntents", code: 8, userInfo: [NSLocalizedDescriptionKey: "File is outside app sandbox"])
    }

    var isDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
      throw NSError(domain: "ZynthFileIntents", code: 9, userInfo: [NSLocalizedDescriptionKey: "File does not exist"])
    }

    return resolved
  }

  private func topViewController(base: UIViewController? = nil) -> UIViewController? {
    let start: UIViewController?
    if let base {
      start = base
    } else {
      start = activeWindow()?.rootViewController
    }

    guard let start else { return nil }

    if let nav = start as? UINavigationController {
      return topViewController(base: nav.visibleViewController)
    }
    if let tab = start as? UITabBarController {
      return topViewController(base: tab.selectedViewController)
    }
    if let presented = start.presentedViewController, presented.viewIfLoaded?.window != nil {
      return topViewController(base: presented)
    }
    return start
  }

  private func activeWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }

    if let activeScene = scenes.first(where: { $0.activationState == .foregroundActive }) {
      if let keyWindow = activeScene.windows.first(where: { $0.isKeyWindow }) {
        return keyWindow
      }
      if let visibleWindow = activeScene.windows.first(where: { !$0.isHidden }) {
        return visibleWindow
      }
      if let firstWindow = activeScene.windows.first {
        return firstWindow
      }
    }

    for scene in scenes {
      if let keyWindow = scene.windows.first(where: { $0.isKeyWindow }) {
        return keyWindow
      }
      if let firstWindow = scene.windows.first {
        return firstWindow
      }
    }

    return nil
  }

  private func onMainSync<T>(_ block: () throws -> T) rethrows -> T {
    if Thread.isMainThread { return try block() }
    return try DispatchQueue.main.sync { try block() }
  }
}
