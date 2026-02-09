import Foundation
import ZynthKit

@objc(SkiaModule)
public final class SkiaModule: NSObject {
  private static var moduleInstance: SkiaRuntimeModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthSkia] Module already initialized")
      return
    }

    let module = SkiaRuntimeModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthSkia] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}

final class SkiaRuntimeModule: NSObject, ZynthModule, ZynthSyncModule {
  let name = "Skia"
  
  var constantsToExport: [String: Any]? {
    [
      "version": "0.1.0",
      "supportsFrameLoop": true,
      "supportsCommands": ["clear", "rect", "circle", "line"],
    ]
  }

  func initialize() {
    // no-op
  }

  func invalidate() {
    ZynthSkiaViewRegistry.shared.clear()
  }

  func call(method: String, args: Any?) throws -> Any? {
    return try callSync(method: method, args: args)
  }
  
  func callSync(method: String, args: Any?) throws -> Any? {
    let payload = args as? [String: Any]
    let nodeId = payload?["nodeId"] as? Int
    let view = nodeId != nil ? ZynthSkiaViewRegistry.shared.view(for: nodeId!) : nil

    switch method {
    case "createSurface":
      view?.markSurfaceReady()
      return ["ok": true]
    case "disposeSurface":
      view?.resetSurface()
      return ["ok": true]
    case "submitDrawCommands":
      let commands = payload?["commands"] as? [[String: Any]] ?? []
      view?.submitCommands(commands)
      return ["ok": true]
    case "submitFrame":
      let frame = payload?["frame"] as? [String: Any]
      view?.submitFrame(frame)
      return ["ok": true]
    case "invalidateSurface":
      view?.invalidateSurface()
      return ["ok": true]
    case "setFrameLoopEnabled":
      let enabled = payload?["enabled"] as? Bool ?? false
      view?.setFrameLoopEnabled(enabled)
      return ["ok": true]
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }
}
