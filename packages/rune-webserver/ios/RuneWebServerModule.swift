import Foundation
import RuneKit

@objc(RuneWebServerModule)
final class RuneWebServerModule: NSObject, RuneModule, RuneSyncModule {
  let name: String = "RuneWebServer"
  private let host = RuneWebServerHost()

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "start":
      do {
        let config = parseStartConfig(args)
        let info = try host.start(config: config)
        return info.toDictionary()
      } catch {
        return errorResponse("start_failed", error.localizedDescription)
      }
    case "stop":
      host.stop()
      return nil
    case "isRunning":
      return host.isRunning()
    case "getInfo":
      return host.info?.toDictionary() ?? NSNull()
    case "drainEvents":
      let maxEvents = getIntArg(args, key: "maxEvents") ?? 50
      let events = host.drainEvents(maxEvents: maxEvents)
      return events.map { $0.toDictionary() }
    default:
      return errorResponse("unsupported_method", method)
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "isRunning":
      return host.isRunning()
    case "getInfo":
      return host.info?.toDictionary() ?? NSNull()
    default:
      throw RuneModuleError.syncNotSupported(module: name, method: method)
    }
  }

  private func parseStartConfig(_ args: Any?) -> RuneWebServerHost.StartConfig {
    let host = getStringArg(args, key: "host")
    let port = getIntArg(args, key: "port") ?? 0
    let documentRoot = getStringArg(args, key: "documentRoot")
    let indexHtml = getStringArg(args, key: "indexHtml")
    let uploadPath = getStringArg(args, key: "uploadPath")
    let uploadDir = resolveUploadDir(
      uploadPath: uploadPath,
      uploadDir: getStringArg(args, key: "uploadDir")
    )
    let maxUploadBytes = getInt64Arg(args, key: "maxUploadBytes") ?? 0
    let eventsPath = getStringArg(args, key: "eventsPath")
    return RuneWebServerHost.StartConfig(
      host: host,
      port: port,
      documentRoot: documentRoot,
      indexHtml: indexHtml,
      uploadPath: uploadPath,
      uploadDir: uploadDir,
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
    return (base as NSString).appendingPathComponent("rune-webserver")
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

  private func getStringArg(_ args: Any?, key: String) -> String? {
    guard let dict = getDictArg(args) else { return nil }
    let value = dict[key]
    return value as? String
  }

  private func getIntArg(_ args: Any?, key: String) -> Int? {
    guard let dict = getDictArg(args) else { return nil }
    let value = dict[key]
    if let number = value as? NSNumber {
      return number.intValue
    }
    if let string = value as? String, let parsed = Int(string) {
      return parsed
    }
    return nil
  }

  private func getInt64Arg(_ args: Any?, key: String) -> Int64? {
    guard let dict = getDictArg(args) else { return nil }
    let value = dict[key]
    if let number = value as? NSNumber {
      return number.int64Value
    }
    if let string = value as? String, let parsed = Int64(string) {
      return parsed
    }
    return nil
  }

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    return ["error": error, "message": message]
  }
}
