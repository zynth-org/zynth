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

  var exportedMethods: [String] {
    return [
      "getPaths", "getDiskSpace", "getSharedContainers", "getPathInfo", "getInfo",
      "listDirectory", "createDirectory", "createFile", "delete", "copy", "move",
      "readText", "readBase64", "readBase64Chunk", "writeText", "writeBase64", "checksum"
    ]
  }

  var protectedMethods: [String] {
    return ["createDirectory", "createFile", "delete", "copy", "move", "writeText", "writeBase64"]
  }

  private let fileManager = FileManager.default

  func call(method: String, args: ZynthArgs) throws -> Any? {
    return try handle(method: method, args: args)
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    return try handle(method: method, args: args)
  }

  private func handle(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getPaths":
      return ["result": getPaths()]
    case "getDiskSpace":
      return ["result": getDiskSpace()]
    case "getSharedContainers":
      return ["result": [String: String]()]
    case "getPathInfo":
      let uri = try args.string("uri")
      return ["result": getPathInfo(uri)]
    case "getInfo":
      let uri = try args.string("uri")
      let options = try? args.dict("options")
      return ["result": try getInfo(uri, options: options)]
    case "listDirectory":
      let uri = try args.string("uri")
      return ["result": try listDirectory(uri)]
    case "createDirectory":
      let uri = try args.string("uri")
      let options = try? args.dict("options")
      try createDirectory(uri, options: options)
      return ["result": true]
    case "createFile":
      let uri = try args.string("uri")
      let options = try? args.dict("options")
      try createFile(uri, options: options)
      return ["result": true]
    case "delete":
      let uri = try args.string("uri")
      let recursive = try args.bool("recursive", default: false)
      try deleteItem(uri, recursive: recursive)
      return ["result": true]
    case "copy":
      let from = try args.string("from")
      let to = try args.string("to")
      try copyItem(from, to)
      return ["result": true]
    case "move":
      let from = try args.string("from")
      let to = try args.string("to")
      try moveItem(from, to)
      return ["result": true]
    case "readText":
      let uri = try args.string("uri")
      return ["result": try readText(uri)]
    case "readBase64":
      let uri = try args.string("uri")
      return ["result": try readBase64(uri)]
    case "readBase64Chunk":
      let uri = try args.string("uri")
      let offset = try Int(args.number("offset"))
      let length = try Int(args.number("length"))
      return ["result": try readBase64Chunk(uri, offset: offset, length: length)]
    case "writeText":
      let uri = try args.string("uri")
      let text = try args.string("text")
      try writeText(uri, text: text)
      return ["result": true]
    case "writeBase64":
      let uri = try args.string("uri")
      let data = try args.string("data")
      try writeBase64(uri, base64: data)
      return ["result": true]
    case "checksum":
      let uri = try args.string("uri")
      let algorithm = try args.string("algorithm", default: "md5")
      return ["result": try checksum(uri, algorithm: algorithm)]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
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
      info["md5"] = digestForFile(atPath: path, algorithm: "md5") ?? NSNull()
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

  private func readBase64Chunk(_ uri: String, offset: Int, length: Int) throws -> String {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    if length <= 0 || offset < 0 {
      throw NSError(domain: "ZynthFileSystem", code: 6, userInfo: [NSLocalizedDescriptionKey: "Invalid offset/length"])
    }

    let url = URL(fileURLWithPath: path)
    let handle = try FileHandle(forReadingFrom: url)
    defer {
      try? handle.close()
    }
    try handle.seek(toOffset: UInt64(offset))
    let data = handle.readData(ofLength: length)
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

  private func checksum(_ uri: String, algorithm: String) throws -> String {
    guard let path = resolvePath(uri) else {
      throw NSError(domain: "ZynthFileSystem", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid uri"])
    }
    guard let digest = digestForFile(atPath: path, algorithm: algorithm) else {
      throw NSError(domain: "ZynthFileSystem", code: 7, userInfo: [NSLocalizedDescriptionKey: "Unable to compute checksum"])
    }
    return digest
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

  private func digestForFile(atPath path: String, algorithm: String) -> String? {
    let normalized = algorithm.lowercased()
    guard let handle = FileHandle(forReadingAtPath: path) else {
      return nil
    }
    defer {
      try? handle.close()
    }

    switch normalized {
    case "md5":
      var digest = Insecure.MD5()
      while true {
        let chunk = handle.readData(ofLength: 64 * 1024)
        if chunk.isEmpty { break }
        digest.update(data: chunk)
      }
      return digest.finalize().map { String(format: "%02hhx", $0) }.joined()
    case "sha1":
      var digest = Insecure.SHA1()
      while true {
        let chunk = handle.readData(ofLength: 64 * 1024)
        if chunk.isEmpty { break }
        digest.update(data: chunk)
      }
      return digest.finalize().map { String(format: "%02hhx", $0) }.joined()
    case "sha256":
      var digest = SHA256()
      while true {
        let chunk = handle.readData(ofLength: 64 * 1024)
        if chunk.isEmpty { break }
        digest.update(data: chunk)
      }
      return digest.finalize().map { String(format: "%02hhx", $0) }.joined()
    default:
      return nil
    }
  }
}
