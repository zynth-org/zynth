import Foundation
import ZynthKit

@objc(ZynthMarkdownModule)
final class ZynthMarkdownModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthMarkdown"

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "parse":
      return parse(args)
    default:
      return errorResponse("unsupported_method", method)
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "parse":
      return parse(args)
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }

  private func parse(_ args: Any?) -> Any? {
    let content = getStringArg(args, key: "content") ?? ""
    let options = getUInt32Arg(args, key: "options") ?? 0
    let extensions = getUInt32Arg(args, key: "extensions") ?? 0
    let json = ZynthMarkdownBridge.parse(
      content,
      options: options,
      extensions: extensions
    )
    return json
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

  private func getUInt32Arg(_ args: Any?, key: String) -> UInt32? {
    guard let dict = getDictArg(args) else { return nil }
    let value = dict[key]
    if let number = value as? NSNumber {
      return number.uint32Value
    }
    if let string = value as? String, let parsed = UInt32(string) {
      return parsed
    }
    return nil
  }

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    return ["error": error, "message": message]
  }
}
