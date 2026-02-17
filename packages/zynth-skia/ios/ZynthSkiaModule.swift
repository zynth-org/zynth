import Foundation
import ZynthKit

@objcMembers
final class ZynthSkiaModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Skia"

  var exportedMethods: [String] {
    return [
      "createSurface",
      "disposeSurface",
      "submitDrawCommands",
      "submitFrame",
      "invalidateSurface",
      "setFrameLoopEnabled"
    ]
  }

  private weak var runtime: ZynthRuntime?

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    return try callSync(method: method, args: args)
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    let payload = (try? args.asDict()) ?? [:]
    switch method {
    case "createSurface":
      return try createSurface(payload)
    case "disposeSurface":
      return try disposeSurface(payload)
    case "submitDrawCommands":
      return try submitDrawCommands(payload)
    case "submitFrame":
      return try submitFrame(payload)
    case "invalidateSurface":
      return try invalidateSurface(payload)
    case "setFrameLoopEnabled":
      return try setFrameLoopEnabled(payload)
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func invalidate() {
    // no-op; native renderer bridge owns surface state
  }

  private func createSurface(_ payload: [String: Any]) throws -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      throw NSError(domain: "ZynthSkia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing nodeId"])
    }

    let result = runOnMainSync { [weak self] in
      guard let self, let runtime = self.runtime else { return false }
      let id = nodeId.intValue
      let created = ZynthSkiaRendererBridge.createSurface(id)
      if let node = runtime.uiManager.zynth_node(forId: nodeId),
         let view = node.view as? ZynthSkiaView {
        view.setSurfaceAvailable(created)
      }
      return created
    }

    if !result {
      throw NSError(domain: "ZynthSkia", code: 2, userInfo: [NSLocalizedDescriptionKey: "Surface creation failed"])
    }
    return ["result": true]
  }

  private func disposeSurface(_ payload: [String: Any]) throws -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      throw NSError(domain: "ZynthSkia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing nodeId"])
    }

    let id = nodeId.intValue
    _ = runOnMainSync { [weak self] in
      guard let self, let runtime = self.runtime else { return false }
      _ = ZynthSkiaRendererBridge.disposeSurface(id)
      if let node = runtime.uiManager.zynth_node(forId: nodeId),
         let view = node.view as? ZynthSkiaView {
        view.setSurfaceAvailable(false)
      }
      return true
    }

    return ["result": true]
  }

  private func submitDrawCommands(_ payload: [String: Any]) throws -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      throw NSError(domain: "ZynthSkia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing nodeId"])
    }
    guard let commands = payload["commands"] as? [[String: Any]] else {
      throw NSError(domain: "ZynthSkia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing commands"])
    }

    let id = nodeId.intValue
    if !ZynthSkiaRendererBridge.hasSurface(id) {
      _ = ZynthSkiaRendererBridge.createSurface(id)
    }

    _ = runOnMainSync { [weak self] in
      guard let self, let runtime = self.runtime else { return false }
      _ = ZynthSkiaRendererBridge.submitCommands(commands, forNode: id)
      if let node = runtime.uiManager.zynth_node(forId: nodeId),
         let view = node.view as? ZynthSkiaView {
        view.markSurfaceDirty()
      }
      return true
    }

    return ["result": true]
  }

  private func submitFrame(_ payload: [String: Any]) throws -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      throw NSError(domain: "ZynthSkia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing nodeId"])
    }
    guard let frame = payload["frame"] as? [String: Any],
          let _ = frame["commands"] as? [[String: Any]] else {
      throw NSError(domain: "ZynthSkia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing frame"])
    }

    let id = nodeId.intValue
    if !ZynthSkiaRendererBridge.hasSurface(id) {
      _ = ZynthSkiaRendererBridge.createSurface(id)
    }

    _ = runOnMainSync { [weak self] in
      guard let self, let runtime = self.runtime else { return false }
      _ = ZynthSkiaRendererBridge.submitFrame(frame, forNode: id)
      if let node = runtime.uiManager.zynth_node(forId: nodeId),
         let view = node.view as? ZynthSkiaView {
        view.markSurfaceDirty()
      }
      return true
    }

    return ["result": true]
  }

  private func invalidateSurface(_ payload: [String: Any]) throws -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      throw NSError(domain: "ZynthSkia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing nodeId"])
    }

    let id = nodeId.intValue
    guard ZynthSkiaRendererBridge.hasSurface(id) else {
      throw NSError(domain: "ZynthSkia", code: 3, userInfo: [NSLocalizedDescriptionKey: "Surface not found"])
    }

    _ = runOnMainSync { [weak self] in
      guard let self, let runtime = self.runtime else { return false }
      guard let node = runtime.uiManager.zynth_node(forId: nodeId),
            let view = node.view as? ZynthSkiaView else {
        return false
      }
      view.markSurfaceDirty()
      return true
    }

    return ["result": true]
  }

  private func setFrameLoopEnabled(_ payload: [String: Any]) throws -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      throw NSError(domain: "ZynthSkia", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing nodeId"])
    }
    let enabled = (payload["enabled"] as? Bool) ?? false

    let id = nodeId.intValue
    guard ZynthSkiaRendererBridge.hasSurface(id) else {
      throw NSError(domain: "ZynthSkia", code: 3, userInfo: [NSLocalizedDescriptionKey: "Surface not found"])
    }

    _ = runOnMainSync { [weak self] in
      guard let self, let runtime = self.runtime else { return false }
      guard let node = runtime.uiManager.zynth_node(forId: nodeId),
            let view = node.view as? ZynthSkiaView else {
        return false
      }
      _ = ZynthSkiaRendererBridge.setFrameLoopEnabled(enabled, forNode: id)
      view.setFrameLoopEnabledValue(enabled)
      return true
    }

    return ["result": true]
  }

  private func runOnMainSync(_ block: @escaping () -> Bool) -> Bool {
    if Thread.isMainThread {
      return block()
    }

    var result = false
    let group = DispatchGroup()
    group.enter()
    DispatchQueue.main.async {
      result = block()
      group.leave()
    }
    _ = group.wait(timeout: .now() + 0.5)
    return result
  }
}
