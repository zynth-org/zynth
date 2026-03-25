import Foundation
import ZynthKit

@objc({{MODULE_NAME_PASCAL}}Module)
class {{MODULE_NAME_PASCAL}}Module: NSObject, ZynthModule, ZynthSyncModule {
  let name = "{{MODULE_NAME_PASCAL}}"

  var exportedMethods: [String] {
    return ["exampleMethod", "exampleSyncMethod"]
  }

  var protectedMethods: [String] {
    return [] // Add methods that require replay protection here
  }
  
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
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }
  
  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "exampleSyncMethod":
      return "Sync result"
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  @objc public static func initialize(with runtime: ZynthRuntime) {
    let module = {{MODULE_NAME_PASCAL}}Module()
    runtime.installModules([module])
  }
}