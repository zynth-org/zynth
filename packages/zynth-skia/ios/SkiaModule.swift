import Foundation
import ZynthKit

@objc(SkiaModule)
class SkiaModule: NSObject, ZynthModule, ZynthSyncModule {
  let name = "Skia"
  
  var constantsToExport: [String: Any]? {
    ["exampleConstant": "Hello from iOS"]
  }

  func initialize() {
    // Module setup
  }

  func invalidate() {
    // Cleanup
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "exampleMethod":
      return ["result": "Async result"]
    default:
      return nil
    }
  }
  
  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "exampleSyncMethod":
      return "Sync result"
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }

  @objc public static func initialize(with runtime: ZynthRuntime) {
    let module = SkiaModule()
    runtime.installModules([module])
  }
}