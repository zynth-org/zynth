import Foundation
import ZynthKit

@objcMembers
final class ZynthSkiaModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Skia"

  private weak var runtime: ZynthRuntime?
  private var surfaces: [Int: SkiaSurfaceState] = [:]

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
  }

  func call(method: String, args: Any?) throws -> Any? {
    return try callSync(method: method, args: args)
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    let payload = args as? [String: Any] ?? [:]
    switch method {
    case "createSurface":
      return createSurface(payload)
    case "disposeSurface":
      return disposeSurface(payload)
    case "submitDrawCommands":
      return submitDrawCommands(payload)
    case "submitFrame":
      return submitFrame(payload)
    case "invalidateSurface":
      return invalidateSurface(payload)
    case "setFrameLoopEnabled":
      return setFrameLoopEnabled(payload)
    default:
      return [
        "error": "unsupported_method",
        "message": "Unsupported Skia method: \(method)",
      ]
    }
  }

  func invalidate() {
    surfaces.removeAll()
  }

  private func createSurface(_ payload: [String: Any]) -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      return error("invalid_argument", "nodeId")
    }

    let result = runOnMainSync { [weak self] in
      guard let self, let runtime else { return false }
      guard let node = runtime.uiManager.zynth_node(forId: nodeId),
            let view = node.view as? ZynthSkiaView else {
        return false
      }
      let id = nodeId.intValue
      self.surfaces[id] = SkiaSurfaceState(nodeId: id)
      let created = ZynthSkiaRendererBridge.createSurface(id)
      view.setSurfaceAvailable(created)
      return created
    }

    return result ? ["result": true] : error("surface_create_failed", "node=\(nodeId)")
  }

  private func disposeSurface(_ payload: [String: Any]) -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      return error("invalid_argument", "nodeId")
    }

    let id = nodeId.intValue
    _ = runOnMainSync { [weak self] in
      guard let self, let runtime else { return false }
      self.surfaces.removeValue(forKey: id)
      _ = ZynthSkiaRendererBridge.disposeSurface(id)
      if let node = runtime.uiManager.zynth_node(forId: nodeId),
         let view = node.view as? ZynthSkiaView {
        view.setSurfaceAvailable(false)
      }
      return true
    }

    return ["result": true]
  }

  private func submitDrawCommands(_ payload: [String: Any]) -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      return error("invalid_argument", "nodeId")
    }
    guard let commands = payload["commands"] as? [[String: Any]] else {
      return error("invalid_argument", "commands")
    }

    let id = nodeId.intValue
    guard var state = surfaces[id] else {
      return error("surface_not_found", "node=\(id)")
    }
    state.lastCommands = commands
    surfaces[id] = state

    _ = runOnMainSync { [weak self] in
      guard let self, let runtime else { return false }
      guard let node = runtime.uiManager.zynth_node(forId: nodeId),
            let view = node.view as? ZynthSkiaView else {
        return false
      }
      _ = ZynthSkiaRendererBridge.submitCommands(commands, forNode: id)
      view.markSurfaceDirty()
      return true
    }

    return ["result": true]
  }

  private func submitFrame(_ payload: [String: Any]) -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      return error("invalid_argument", "nodeId")
    }
    guard let frame = payload["frame"] as? [String: Any],
          let commands = frame["commands"] as? [[String: Any]] else {
      return error("invalid_argument", "frame")
    }

    let id = nodeId.intValue
    guard var state = surfaces[id] else {
      return error("surface_not_found", "node=\(id)")
    }
    state.lastCommands = commands
    surfaces[id] = state

    _ = runOnMainSync { [weak self] in
      guard let self, let runtime else { return false }
      guard let node = runtime.uiManager.zynth_node(forId: nodeId),
            let view = node.view as? ZynthSkiaView else {
        return false
      }
      _ = ZynthSkiaRendererBridge.submitFrame(frame, forNode: id)
      view.markSurfaceDirty()
      return true
    }

    return ["result": true]
  }

  private func invalidateSurface(_ payload: [String: Any]) -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      return error("invalid_argument", "nodeId")
    }

    let id = nodeId.intValue
    guard surfaces[id] != nil else {
      return error("surface_not_found", "node=\(id)")
    }

    _ = runOnMainSync { [weak self] in
      guard let self, let runtime else { return false }
      guard let node = runtime.uiManager.zynth_node(forId: nodeId),
            let view = node.view as? ZynthSkiaView else {
        return false
      }
      view.markSurfaceDirty()
      return true
    }

    return ["result": true]
  }

  private func setFrameLoopEnabled(_ payload: [String: Any]) -> [String: Any] {
    guard let nodeId = payload["nodeId"] as? NSNumber else {
      return error("invalid_argument", "nodeId")
    }
    let enabled = (payload["enabled"] as? Bool) ?? false

    let id = nodeId.intValue
    guard var state = surfaces[id] else {
      return error("surface_not_found", "node=\(id)")
    }
    state.frameLoopEnabled = enabled
    surfaces[id] = state

    _ = runOnMainSync { [weak self] in
      guard let self, let runtime else { return false }
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

  private func error(_ code: String, _ message: String) -> [String: String] {
    return ["error": code, "message": message]
  }
}

private struct SkiaSurfaceState {
  let nodeId: Int
  var frameLoopEnabled: Bool = false
  var lastCommands: [[String: Any]] = []
}
