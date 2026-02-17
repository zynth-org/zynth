import Foundation
import ZynthKit

@objc(ZynthMarkdownModule)
final class ZynthMarkdownModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "ZynthMarkdown"

  var exportedMethods: [String] {
    return ["parse"]
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "parse":
      return ["result": parse(args)]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "parse":
      return parse(args)
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func parse(_ args: ZynthArgs) -> Any? {
    let content = args.string("content", default: "")
    let options = UInt32(args.number("options", default: 0))
    let extensions = UInt32(args.number("extensions", default: 0))
    let json = ZynthMarkdownBridge.parse(
      content,
      options: options,
      extensions: extensions
    )
    return json
  }
}
