import Foundation
import ZynthKit

@objc(ZynthWebServerModule)
final class ZynthWebServerModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthWebServer"
  private let host = ZynthWebServerHost()

  var exportedMethods: [String] {
    return ["start", "stop", "isRunning", "getInfo", "getUploadState", "drainEvents"]
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
    case "getUploadState":
      return ["result": host.getUploadState().toDictionary()]
    case "drainEvents":
      let maxEvents = Int(args.number("maxEvents", default: 50))
      let events = host.drainEvents(maxEvents: maxEvents)
      return ["result": events.map { $0.toDictionary() }]
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
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }

  private func parseStartConfig(_ args: ZynthArgs) -> ZynthWebServerHost.StartConfig {
    let host = args.optionalString("host")
    let port = Int(args.number("port", default: 0))
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
}
