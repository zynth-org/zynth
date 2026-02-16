import Foundation
import ZynthKit

@objc({{MODULE_NAME_PASCAL}}Module)
class {{MODULE_NAME_PASCAL}}Module: NSObject, ZynthModule, ZynthSyncModule {
  let name = "{{MODULE_NAME_PASCAL}}"
  
  var constantsToExport: [String: Any]? {
    ["exampleConstant": "Hello from iOS"]
  }

  func initialize() {
    // Module setup
  }

  func invalidate() {
    // Cleanup
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "exampleMethod":
      return ["result": "Async result"]
    default:
      return nil
    }
  }
  
  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "exampleSyncMethod":
      return "Sync result"
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }

  @objc public static func initialize(with runtime: ZynthRuntime) {
    let module = {{MODULE_NAME_PASCAL}}Module()
    runtime.installModules([module])
  }
}