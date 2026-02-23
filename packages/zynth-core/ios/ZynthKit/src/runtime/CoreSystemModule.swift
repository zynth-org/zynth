import Foundation

@objc(CoreSystemModule)
final class CoreSystemModule: NSObject, ZynthModule {
  let name: String = "CoreSystem"
  private weak var runtime: ZynthRuntime?

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }

  var exportedMethods: [String] {
    ["enableFeatures", "getMetrics", "getStartupMetrics"]
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "enableFeatures":
      return try handleEnableFeatures(args: args)
    case "getMetrics":
      return handleGetMetrics()
    case "getStartupMetrics":
      return handleGetStartupMetrics()
    default:
      return ["error": "unknown_method", "method": method]
    }
  }

  private func handleEnableFeatures(args: ZynthArgs) throws -> Any {
    guard let runtime else {
      return ["error": "runtime_deallocated"]
    }
    let rawFeatures = try args.array("features")
    var features: [String] = []
    features.reserveCapacity(rawFeatures.count)
    for value in rawFeatures {
      if let feature = value as? String {
        features.append(feature)
      }
    }
    ZynthStartupMetricsRegistry.enableFeatures(forSession: runtime.bridgeSessionId, features: features)
    return ["result": true]
  }

  private func handleGetMetrics() -> Any {
    guard let runtime else {
      return ["result": [:]]
    }
    let snapshot = ZynthStartupMetricsRegistry.metricsSnapshot(forSession: runtime.bridgeSessionId)
    return ["result": snapshot]
  }

  private func handleGetStartupMetrics() -> Any {
    guard let runtime else {
      return ["result": NSNull()]
    }
    let startup = ZynthStartupMetricsRegistry.startupMetrics(forSession: runtime.bridgeSessionId)
    let result: Any = startup ?? NSNull()
    return ["result": result]
  }
}
