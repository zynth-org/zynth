import Foundation
import ZynthKit
import CryptoKit

@objc(ZynthWebServerModule)
final class ZynthWebServerModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthWebServer"
  private let host = ZynthWebServerHost()

  var exportedMethods: [String] {
    return [
      "start",
      "stop",
      "isRunning",
      "getInfo",
      "getManagedTlsCertificate",
      "getUploadState",
      "drainEvents",
      "upsertManagedTlsCertificate",
      "setSignal",
      "getSignal",
      "setReply",
      "getReply",
    ]
  }

  var protectedMethods: [String] {
    return ["start", "stop"]
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "start":
      let config = parseStartConfig(args)
      let info = try host.start(config: config)
      return ["result": info.toDictionary()]
    case "stop":
      host.stop()
      return ["result": true]
    case "isRunning":
      return ["result": host.isRunning()]
    case "getInfo":
      let info = host.info?.toDictionary()
      return ["result": info as Any? ?? NSNull()]
    case "getManagedTlsCertificate":
      let alias = sanitizeAlias(args.string("alias", default: "default"))
      let result = try getManagedTlsCertificate(alias: alias)
      return ["result": result as Any? ?? NSNull()]
    case "getUploadState":
      return ["result": host.getUploadState().toDictionary()]
    case "drainEvents":
      let maxEvents = Int(args.number("maxEvents", default: 50))
      let events = host.drainEvents(maxEvents: maxEvents)
      return ["result": events.map { $0.toDictionary() }]
    case "upsertManagedTlsCertificate":
      let alias = sanitizeAlias(args.string("alias", default: "default"))
      let generateIfMissing = args.bool("generateIfMissing", default: false)
      let commonName = args.string("commonName", default: "localhost")
        .trimmingCharacters(in: .whitespacesAndNewlines)
      let validDays = max(1, min(3650, Int(args.number("validDays", default: 365))))
      var pem = args.string("pem", default: "").trimmingCharacters(in: .whitespacesAndNewlines)
      if pem.isEmpty && generateIfMissing {
        let generatedPem = ZynthWebServerBridge.generateSelfSignedPem(
          withCommonName: commonName.isEmpty ? "localhost" : commonName,
          validDays: validDays
        )?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let generatedPem, !generatedPem.isEmpty {
          pem = generatedPem
        } else {
          let details = ZynthWebServerBridge.lastError() ?? "unknown"
          throw NSError(
            domain: "ZynthWebServer",
            code: 2202,
            userInfo: [NSLocalizedDescriptionKey: "Failed to generate self-signed certificate (\(details))"]
          )
        }
      }
      if pem.isEmpty {
        throw NSError(
          domain: "ZynthWebServer",
          code: 2201,
          userInfo: [NSLocalizedDescriptionKey: "pem is required (or set generateIfMissing=true)"]
        )
      }
      let rotateAfterMs = max(1, Int64(args.number("rotateAfterMs", default: 30 * 24 * 60 * 60 * 1000)))
      let result = try upsertManagedTlsCertificate(alias: alias, pem: pem, rotateAfterMs: rotateAfterMs)
      return ["result": result]
    case "setReply":
      let key = args.string("key", default: "").trimmingCharacters(in: .whitespacesAndNewlines)
      let payloadJson = args.string("payloadJson", default: "null")
      let ok = host.setReply(key: key, payloadJson: payloadJson)
      return ["result": ok]
    case "getReply":
      let key = args.string("key", default: "").trimmingCharacters(in: .whitespacesAndNewlines)
      let consume = args.bool("consume", default: true)
      let result = host.getReply(key: key, consume: consume)
      return ["result": result ?? NSNull()]
    case "setSignal":
      let key = args.string("key", default: "").trimmingCharacters(in: .whitespacesAndNewlines)
      let payloadJson = args.string("payloadJson", default: "null")
      let ok = host.setReply(key: key, payloadJson: payloadJson)
      return ["result": ok]
    case "getSignal":
      let key = args.string("key", default: "").trimmingCharacters(in: .whitespacesAndNewlines)
      let consume = args.bool("consume", default: true)
      let result = host.getReply(key: key, consume: consume)
      return ["result": result ?? NSNull()]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "isRunning":
      return host.isRunning()
    case "getInfo":
      return host.info?.toDictionary() ?? NSNull()
    case "getUploadState":
      return host.getUploadState().toDictionary()
    case "getReply":
      let key = args.string("key", default: "").trimmingCharacters(in: .whitespacesAndNewlines)
      let consume = args.bool("consume", default: true)
      return host.getReply(key: key, consume: consume) ?? NSNull()
    case "getSignal":
      let key = args.string("key", default: "").trimmingCharacters(in: .whitespacesAndNewlines)
      let consume = args.bool("consume", default: true)
      return host.getReply(key: key, consume: consume) ?? NSNull()
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }

  private func parseStartConfig(_ args: ZynthArgs) -> ZynthWebServerHost.StartConfig {
    let host = args.optionalString("host")
    let port = Int(args.number("port", default: 0))
    let tlsEnabled = args.bool("tlsEnabled", default: false)
    let tlsCertificate = args.optionalString("tlsCertificate")
    let documentRoot = args.optionalString("documentRoot")
    let indexHtml = args.optionalString("indexHtml")
    let uploadPath = args.optionalString("uploadPath")
    let uploadDir = resolveUploadDir(
      uploadPath: uploadPath,
      uploadDir: args.optionalString("uploadDir")
    )
    let uploadMetadataPath = args.optionalString("uploadMetadataPath")
    let uploadAuthToken = args.optionalString("uploadAuthToken")
    let uploadAuthHeader = args.optionalString("uploadAuthHeader")
    let uploadAuthQueryKey = args.optionalString("uploadAuthQueryKey")
    let maxUploadBytes = (try? args.int64("maxUploadBytes")) ?? 0
    let eventsPath = args.optionalString("eventsPath")
    return ZynthWebServerHost.StartConfig(
      host: host,
      port: port,
      tlsEnabled: tlsEnabled,
      tlsCertificate: tlsCertificate,
      documentRoot: documentRoot,
      indexHtml: indexHtml,
      uploadPath: uploadPath,
      uploadDir: uploadDir,
      uploadMetadataPath: uploadMetadataPath,
      uploadAuthToken: uploadAuthToken,
      uploadAuthHeader: uploadAuthHeader,
      uploadAuthQueryKey: uploadAuthQueryKey,
      maxUploadBytes: maxUploadBytes,
      eventsPath: eventsPath
    )
  }

  private func resolveUploadDir(uploadPath: String?, uploadDir: String?) -> String? {
    guard uploadPath != nil else {
      return nil
    }
    if let uploadDir, !uploadDir.isEmpty {
      return uploadDir
    }
    let base = NSTemporaryDirectory()
    return (base as NSString).appendingPathComponent("zynth-webserver")
  }

  private func upsertManagedTlsCertificate(
    alias: String,
    pem: String,
    rotateAfterMs: Int64
  ) throws -> [String: Any] {
    let fileManager = FileManager.default
    let cacheDir = try fileManager.url(
      for: .cachesDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let tlsDir = cacheDir
      .appendingPathComponent("zynth-webserver", isDirectory: true)
      .appendingPathComponent("tls", isDirectory: true)
    if !fileManager.fileExists(atPath: tlsDir.path) {
      try fileManager.createDirectory(at: tlsDir, withIntermediateDirectories: true)
    }

    let pemUrl = tlsDir.appendingPathComponent("\(alias).pem")
    let metaUrl = tlsDir.appendingPathComponent("\(alias).meta")
    let now = Int64(Date().timeIntervalSince1970 * 1000.0)
    let existed = fileManager.fileExists(atPath: pemUrl.path)
    var shouldRewrite = true
    if existed {
      let existingPem = try? String(contentsOf: pemUrl, encoding: .utf8)
      let lastUpdatedAt = parseUpdatedAt(from: metaUrl)
      let hasExpired = now - lastUpdatedAt >= rotateAfterMs
      shouldRewrite = existingPem != pem || hasExpired
    }
    if shouldRewrite {
      try pem.write(to: pemUrl, atomically: true, encoding: .utf8)
      try String(now).write(to: metaUrl, atomically: true, encoding: .utf8)
    }

    let updatedAt = shouldRewrite ? now : parseUpdatedAt(from: metaUrl)
    return [
      "alias": alias,
      "certificatePath": pemUrl.path,
      "fingerprintSha256": sha256Hex(pem),
      "updatedAt": updatedAt,
      "existed": existed,
    ]
  }

  private func getManagedTlsCertificate(alias: String) throws -> [String: Any]? {
    let fileManager = FileManager.default
    let cacheDir = try fileManager.url(
      for: .cachesDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let tlsDir = cacheDir
      .appendingPathComponent("zynth-webserver", isDirectory: true)
      .appendingPathComponent("tls", isDirectory: true)
    let pemUrl = tlsDir.appendingPathComponent("\(alias).pem")
    let metaUrl = tlsDir.appendingPathComponent("\(alias).meta")
    guard fileManager.fileExists(atPath: pemUrl.path) else {
      return nil
    }

    let pemBundle = try String(contentsOf: pemUrl, encoding: .utf8)
    guard let certificatePem = extractCertificatePem(pemBundle) else {
      throw NSError(
        domain: "ZynthWebServer",
        code: 2203,
        userInfo: [NSLocalizedDescriptionKey: "Managed certificate file does not contain a certificate PEM block"]
      )
    }
    let updatedAt = parseUpdatedAt(from: metaUrl)
    return [
      "alias": alias,
      "certificatePath": pemUrl.path,
      "certificatePem": certificatePem,
      "fingerprintSha256": sha256Hex(certificatePem),
      "updatedAt": updatedAt,
    ]
  }

  private func parseUpdatedAt(from fileUrl: URL) -> Int64 {
    guard let value = try? String(contentsOf: fileUrl, encoding: .utf8) else {
      return 0
    }
    return Int64(value.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
  }

  private func extractCertificatePem(_ pemBundle: String) -> String? {
    guard let regex = try? NSRegularExpression(
      pattern: "-----BEGIN CERTIFICATE-----[\\s\\S]*?-----END CERTIFICATE-----",
      options: []
    ) else {
      return nil
    }
    let range = NSRange(pemBundle.startIndex..<pemBundle.endIndex, in: pemBundle)
    let matches = regex.matches(in: pemBundle, options: [], range: range)
    if matches.isEmpty {
      return nil
    }
    var blocks: [String] = []
    for match in matches {
      guard let swiftRange = Range(match.range, in: pemBundle) else {
        continue
      }
      let block = String(pemBundle[swiftRange]).trimmingCharacters(in: .whitespacesAndNewlines)
      if !block.isEmpty {
        blocks.append(block)
      }
    }
    if blocks.isEmpty {
      return nil
    }
    return blocks.joined(separator: "\n") + "\n"
  }

  private func sanitizeAlias(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return "default"
    }
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    let scalars = trimmed.unicodeScalars.map { scalar -> Character in
      return allowed.contains(scalar) ? Character(scalar) : "_"
    }
    let result = String(scalars)
    return result.isEmpty ? "default" : result
  }

  private func sha256Hex(_ value: String) -> String {
    let digest = SHA256.hash(data: Data(value.utf8))
    let digestBytes = Array(digest)
    var output = ""
    output.reserveCapacity(digestBytes.count * 2)
    for byte in digestBytes {
      output.append(String(format: "%02x", byte))
    }
    return output
  }
}
