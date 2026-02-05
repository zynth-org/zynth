import Foundation
import ZynthKit

final class ZynthAutomationModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Automation"

  private weak var runtime: ZynthRuntime?

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "read":
      return ["result": readSnapshot(args: args)]
    default:
      return [
        "error": "unknown_method",
        "method": method,
      ]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "read":
      return readSnapshot(args: args)
    default:
      return [
        "error": "unknown_method",
        "method": method,
      ]
    }
  }

  private func readSnapshot(args: Any?) -> [String: Any] {
    guard let runtime else {
      return ["error": "runtime_deallocated"]
    }
    let options = args as? [String: Any]
    return runtime.uiManager.snapshot(options) as? [String: Any] ?? [:]
  }
}
