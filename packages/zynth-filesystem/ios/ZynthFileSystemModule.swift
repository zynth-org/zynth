//
//  ZynthFileSystemModule.swift
//  ZynthFileSystem
//
//  Native file system module for Zynth
//

import Foundation
import ZynthKit
import CryptoKit
import UniformTypeIdentifiers

@objc(ZynthFileSystemModule)
final class ZynthFileSystemModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthFileSystem"
  private let fileManager = FileManager.default

  func call(method: String, args: Any?) throws -> Any? {
    return handle(method: method, args: args)
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    return handle(method: method, args: args)
  }

  private func handle(method: String, args: Any?) -> Any? {
    do {
      switch method {
      case "getPaths":
        return getPaths()
      case "getDiskSpace":
        return getDiskSpace()
      case "getSharedContainers":
        return [String: String]()
      case "getPathInfo":
        guard let uri = getStringArg(args, key: "uri") else {
          return errorResponse("invalid_argument", "uri")
        }
        return getPathInfo(uri)
      case "getInfo":
        guard let uri = getStringArg(args, key: "uri") else {
          return errorResponse("invalid_argument", "uri")
        }
        let options = getDictArg(args, key: "options")
        return try getInfo(uri, options: options)
      case "listDirectory":
        guard let uri = getStringArg(args, key: "uri") else {
          return errorResponse("invalid_argument", "uri")
        }
        return try listDirectory(uri)
      case "createDirectory":
        guard let uri = getStringArg(args, key: "uri") else {
          return errorResponse("invalid_argument", "uri")
        }
        let options = getDictArg(args, key: "options")
        try createDirectory(uri, options: options)
        return nil
      case "createFile":
        guard let uri = getStringArg(args, key: "uri") else {
          return errorResponse("invalid_argument", "uri")
        }
        let options = getDictArg(args, key: "options")
        try createFile(uri, options: options)
        return nil
      case "delete":
        guard let uri = getStringArg(args, key: "uri") else {
          return errorResponse("invalid_argument", "uri")
        }
        let recursive = getBoolArg(args, key: "recursive") ?? false
        try deleteItem(uri, recursive: recursive)
        return nil
      case "copy":
        guard let from = getStringArg(args, key: "from"),
              let to = getStringArg(args, key: "to") else {
          return errorResponse("invalid_argument", "from/to")
        }
        try copyItem(from, to)
        return nil
      case "move":
        guard let from = getStringArg(args, key: "from"),
              let to = getStringArg(args, key: "to") else {
          return errorResponse("invalid_argument", "from/to")
        }
        try moveItem(from, to)
        return nil
      case "readText":
        guard let uri = getStringArg(args, key: "uri") else {
          return errorResponse("invalid_argument", "uri")
        }
        return try readText(uri)
      case "readBase64":
        guard let uri = getStringArg(args, key: "uri") else {
          return errorResponse("invalid_argument", "uri")
        }
        return try readBase64(uri)
      case "writeText":
        guard let uri = getStringArg(args, key: "uri"),
              let text = getStringArg(args, key: "text") else {
          return errorResponse("invalid_argument", "uri/text")
        }
        try writeText(uri, text: text)
        return nil
      case "writeBase64":
        guard let uri = getStringArg(args, key: "uri"),
              let data = getStringArg(args, key: "data") else {
          return errorResponse("invalid_argument", "uri/data")
        }
        try writeBase64(uri, base64: data)
        return nil
      default:
        return errorResponse("unsupported_method", method)
      }
    } catch {
      return errorResponse("io_error", error.localizedDescription)
    }
  }

  private func getPaths() -> [String: String] {
    let document = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first
    let cache = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
    let bundle = Bundle.main.bundleURL
    return [
      "document": document?.absoluteString ?? "",
      "cache": cache?.absoluteString ?? "",
      "bundle": bundle.absoluteString,
    ]
  }

  private func getDiskSpace() -> [String: NSNumber] {
    let attributes = try? fileManager.attributesOfFileSystem(forPath: NSHomeDirectory())
    let total = (attributes?[.systemSize] as? NSNumber) ?? 0
    let free = (attributes?[.systemFreeSize] as? NSNumber) ?? 0
    return ["total": total, "available": free]
  }

  private func getPathInfo(_ uri: String) -> [String: Any] {
    guard let path = resolvePath(uri) else {
      return ["exists": false, "isDirectory": NSNull()]
    }
    var isDirectory: ObjCBool = false
    let exists = fileManager.fileExists(atPath: path, isDirectory: &isDirectory)
    return [
      "exists": exists,
      "isDirectory": exists ? isDirectory.boolValue : NSNull(),
    ]
  }

  private func getInfo(_ uri: String, options: [String: Any]?) throws -> [String: Any] {
    guard let path = resolvePath(uri) else {
      return [
        "uri": uri,
        "exists": false,
        "size": 0,
        "creationTime": NSNull(),
        "modificationTime": NSNull(),
        "md5": NSNull(),
        "type": "",
      ]
    }

    var isDirectory: ObjCBool = false
    let exists = fileManager.fileExists(atPath: path, isDirectory: &isDirectory)

    if !exists {
      return [
        "uri": uri,
        "exists": false,
        "size": 0,
        "creationTime": NSNull(),
        "modificationTime": NSNull(),
        "md5": NSNull(),
        "type": "",
      ]
    }

    let attributes = try? fileManager.attributesOfItem(atPath: path)
    let creationDate = attributes?[.creationDate] as? Date
    let modificationDate = attributes?[.modificationDate] as? Date
    let sizeValue = attributes?[.size] as? NSNumber

    var info: [String: Any] = [
      "uri": uri,
      "exists": true,
      "creationTime": creationDate?.timeIntervalSince1970 != nil
        ? NSNumber(value: creationDate!.timeIntervalSince1970 * 1000)
        : NSNull(),
      "modificationTime": modificationDate?.timeIntervalSince1970 != nil
        ? NSNumber(value: modificationDate!.timeIntervalSince1970 * 1000)
        : NSNull(),
      "type": isDirectory.boolValue ? "" : mimeType(for: path),
    ]

    if isDirectory.boolValue {
      info["size"] = NSNull()
    } else {
      info["size"] = sizeValue ?? 0
    }

    if let options = options,
       let md5Requested = options["md5"] as? Bool,
       md5Requested,
       !isDirectory.boolValue {
      info["md5"] = md5ForFile(atPath: path) ?? NSNull()
    }

    return info
  }

  private func listDirectory(_ uri: String) throws -> [[String: Any]] {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    let url = URL(fileURLWithPath: path)
    let urls = try fileManager.contentsOfDirectory(
      at: url,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: []
    )
    return try urls.map { entry in
      let values = try entry.resourceValues(forKeys: [.isDirectoryKey])
      return [
        "name": entry.lastPathComponent,
        "uri": entry.absoluteString,
        "isDirectory": values.isDirectory ?? false,
      ]
    }
  }

  private func createDirectory(_ uri: String, options: [String: Any]?) throws {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    let intermediates = options?["intermediates"] as? Bool ?? false
    let overwrite = options?["overwrite"] as? Bool ?? false
    let idempotent = options?["idempotent"] as? Bool ?? false

    if fileManager.fileExists(atPath: path) {
      if overwrite {
        try fileManager.removeItem(atPath: path)
      } else if idempotent {
        return
      } else {
        throw NSError(domain: "ZynthFileSystem", code: 2, userInfo: [NSLocalizedDescriptionKey: "Destination already exists"])
      }
    }

    try fileManager.createDirectory(atPath: path, withIntermediateDirectories: intermediates, attributes: nil)
  }

  private func createFile(_ uri: String, options: [String: Any]?) throws {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    let intermediates = options?["intermediates"] as? Bool ?? false
    let overwrite = options?["overwrite"] as? Bool ?? false

    if fileManager.fileExists(atPath: path) {
      if overwrite {
        try fileManager.removeItem(atPath: path)
      } else {
        return
      }
    }

    if intermediates {
      try ensureParentDirectories(for: path)
    }

    fileManager.createFile(atPath: path, contents: nil, attributes: nil)
  }

  private func deleteItem(_ uri: String, recursive: Bool) throws {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    var isDirectory: ObjCBool = false
    if !fileManager.fileExists(atPath: path, isDirectory: &isDirectory) {
      return
    }
    if isDirectory.boolValue && !recursive {
      let contents = try fileManager.contentsOfDirectory(atPath: path)
      if !contents.isEmpty {
        throw NSError(domain: "ZynthFileSystem", code: 3, userInfo: [NSLocalizedDescriptionKey: "Directory not empty"])
      }
    }
    try fileManager.removeItem(atPath: path)
  }

  private func copyItem(_ from: String, _ to: String) throws {
    guard let fromPath = resolvePath(from), let toPath = resolvePath(to) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    if fileManager.fileExists(atPath: toPath) {
      throw NSError(domain: "ZynthFileSystem", code: 4, userInfo: [NSLocalizedDescriptionKey: "Destination already exists"])
    }
    try ensureParentDirectories(for: toPath)
    try fileManager.copyItem(atPath: fromPath, toPath: toPath)
  }

  private func moveItem(_ from: String, _ to: String) throws {
    guard let fromPath = resolvePath(from), let toPath = resolvePath(to) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    if fileManager.fileExists(atPath: toPath) {
      throw NSError(domain: "ZynthFileSystem", code: 4, userInfo: [NSLocalizedDescriptionKey: "Destination already exists"])
    }
    try ensureParentDirectories(for: toPath)
    try fileManager.moveItem(atPath: fromPath, toPath: toPath)
  }

  private func readText(_ uri: String) throws -> String {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    return try String(contentsOfFile: path, encoding: .utf8)
  }

  private func readBase64(_ uri: String) throws -> String {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    return data.base64EncodedString()
  }

  private func writeText(_ uri: String, text: String) throws {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    try ensureParentDirectories(for: path)
    try text.write(toFile: path, atomically: true, encoding: .utf8)
  }

  private func writeBase64(_ uri: String, base64: String) throws {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    guard let data = Data(base64Encoded: base64) else {
      throw NSError(domain: "ZynthFileSystem", code: 5, userInfo: [NSLocalizedDescriptionKey: "Invalid base64"])
    }
    try ensureParentDirectories(for: path)
    try data.write(to: URL(fileURLWithPath: path), options: .atomic)
  }

  private func ensureParentDirectories(for path: String) throws {
    let parent = (path as NSString).deletingLastPathComponent
    if parent.isEmpty { return }
    if !fileManager.fileExists(atPath: parent) {
      try fileManager.createDirectory(atPath: parent, withIntermediateDirectories: true, attributes: nil)
    }
  }

  private func resolvePath(_ uri: String) -> String? {
    if uri.hasPrefix("file://") {
      return URL(string: uri)?.path
    }
    if uri.hasPrefix("/") {
      return uri
    }
    guard let url = URL(string: uri) else {
      return uri
    }
    if let scheme = url.scheme, scheme != "file" {
      return nil
    }
    return url.path
  }

  private func mimeType(for path: String) -> String {
    let ext = URL(fileURLWithPath: path).pathExtension
    if ext.isEmpty { return "" }
    if #available(iOS 14.0, *) {
      return UTType(filenameExtension: ext)?.preferredMIMEType ?? ""
    }
    return ""
  }

  private func md5ForFile(atPath path: String) -> String? {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else {
      return nil
    }
    let digest = Insecure.MD5.hash(data: data)
    return digest.map { String(format: "%02hhx", $0) }.joined()
  }

  private func unwrapArgs(_ args: Any?) -> Any? {
    if let array = args as? [Any], array.count == 1 {
      let value = array[0]
      return value is NSNull ? nil : value
    }
    return args
  }

  private func getDictArg(_ args: Any?, key: String? = nil) -> [String: Any]? {
    let unwrapped = unwrapArgs(args)
    if let dict = unwrapped as? [String: Any] {
      if let key = key {
        return dict[key] as? [String: Any]
      }
      return dict
    }
    if let dict = unwrapped as? NSDictionary {
      let swiftDict = dict as? [String: Any]
      if let key = key {
        return swiftDict?[key] as? [String: Any]
      }
      return swiftDict
    }
    return nil
  }

  private func getStringArg(_ args: Any?, key: String) -> String? {
    guard let dict = getDictArg(args) else { return nil }
    let value = dict[key]
    return value as? String
  }

  private func getBoolArg(_ args: Any?, key: String) -> Bool? {
    guard let dict = getDictArg(args) else { return nil }
    return dict[key] as? Bool
  }

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    return ["error": error, "message": message]
  }
}
