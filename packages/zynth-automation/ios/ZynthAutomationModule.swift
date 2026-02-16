import Foundation
import ZynthKit

final class ZynthAutomationModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Automation"

  private weak var runtime: ZynthRuntime?
  private var productionInspectionEnabled = false

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "read":
      return ["result": try readSnapshot(args: args)]
    case "configure":
      return ["result": configure(args: args)]
    default:
      return [
        "error": "unknown_method",
        "method": method,
      ]
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "read":
      return try readSnapshot(args: args)
    case "configure":
      return configure(args: args)
    default:
      return [
        "error": "unknown_method",
        "method": method,
      ]
    }
  }

  private func readSnapshot(args: ZynthArgs) throws -> [String: Any] {
    guard let runtime else {
      return ["error": "runtime_deallocated"]
    }
    var options = (try? args.asDict()) ?? [:]
    if !isDebugBuild && !productionInspectionEnabled {
      // Heavy fields are disabled in production by default to reduce overhead.
      options["includeResolvedStyles"] = false
      options["includeComponentState"] = false
      options["includeText"] = false
    }
    return runtime.uiManager.snapshot(options) as? [String: Any] ?? [:]
  }

  private func configure(args: ZynthArgs) -> [String: Any] {
    let config = try? args.asDict()
    productionInspectionEnabled = config?["enableProductionInspection"] as? Bool ?? false
    return ["productionInspectionEnabled": productionInspectionEnabled]
  }

  private var isDebugBuild: Bool {
#if DEBUG
    return true
#else
    return false
#endif
  }
}
