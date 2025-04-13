import Foundation
import RuneKit
import UIKit

final class RuneRouterModule: NSObject, RuneModule, RuneSyncModule {
  let name: String = "RuneRouter"

  private weak var runtime: RuneRuntime?
  private weak var stackController: RNStackController?
  private let emitter: RuneRouterEmitter
  private var registeredScreens: [[String: Any]] = []
  private var beforeRemoveResolvers: [String: (Bool) -> Void] = [:]
  var sharedEmitter: RuneRouterEmitter { emitter }

  init(runtime: RuneRuntime, stackController: RNStackController) {
    self.runtime = runtime
    self.stackController = stackController
    self.emitter = RuneRouterEmitter(runtime: runtime)
    super.init()
    stackController.bindRouterModule(self, emitter: emitter)
  }

  func attach(stackController: RNStackController) {
    self.stackController = stackController
    stackController.bindRouterModule(self, emitter: emitter)
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "dispatch":
      guard
        let dict = args as? [String: Any],
        let action = dict["action"] as? [String: Any]
      else { return ["error": "invalid_action"] }
      handleDispatch(action)
      return ["result": "ok"]
    case "setOptions":
      guard
        let dict = args as? [String: Any],
        let key = dict["key"] as? String,
        let options = dict["options"] as? [String: Any]
      else { return ["error": "invalid_options"] }
      DispatchQueue.main.async { [weak self] in
        self?.stackController?.applyOptions(for: key, options: options)
      }
      return ["result": "ok"]
    case "registerScreens":
      guard let dict = args as? [String: Any],
        let screens = dict["screens"] as? [[String: Any]]
      else { return ["error": "invalid_screens"] }
      registeredScreens = screens
      return ["result": "ok"]
    case "resolveBeforeRemove":
      guard
        let dict = args as? [String: Any],
        let requestId = dict["requestId"] as? String,
        let cancelled = dict["cancelled"] as? Bool
      else { return ["error": "invalid_request"] }
      resolveBeforeRemove(requestId: requestId, cancelled: cancelled)
      return ["result": "ok"]
    default:
      return ["error": "unknown_method"]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "getState":
      let state = stackController?.currentStatePayload()
      return ["state": state as Any]
    default:
      throw RuneModuleError.syncNotSupported(module: name, method: method)
    }
  }

  func requestBeforeRemove(
    for routeKey: String,
    action: [String: Any],
    completion: @escaping (Bool) -> Void
  ) {
    let requestId = UUID().uuidString
    beforeRemoveResolvers[requestId] = completion
    emitter.emitBeforeRemove(action: action, key: routeKey, requestId: requestId)
  }

  private func resolveBeforeRemove(requestId: String, cancelled: Bool) {
    guard let completion = beforeRemoveResolvers.removeValue(forKey: requestId) else {
      return
    }
    completion(!cancelled)
  }

  private func handleDispatch(_ action: [String: Any]) {
    guard let type = action["type"] as? String else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      switch type {
      case "PUSH", "NAVIGATE":
        guard let payload = action["payload"] as? [String: Any],
          let name = payload["name"] as? String
        else { return }
        let params = payload["params"] as? [String: Any]
        self.stackController?.push(routeName: name, params: params, animated: true)
      case "POP":
        let payload = action["payload"] as? [String: Any]
        let count = payload?["count"] as? Int ?? 1
        self.stackController?.pop(count: count, animated: true)
      case "REPLACE":
        guard let payload = action["payload"] as? [String: Any],
          let name = payload["name"] as? String
        else { return }
        let params = payload["params"] as? [String: Any]
        self.stackController?.replaceTop(with: name, params: params, animated: true)
      case "RESET":
        guard let state = action["state"] as? [String: Any] else { return }
        self.stackController?.reset(using: state, animated: true)
      case "SET_PARAMS":
        guard
          let payload = action["payload"] as? [String: Any],
          let source = action["source"] as? String
        else { return }
        self.stackController?.setParams(for: source, params: payload)
      default:
        #if DEBUG
          print("[RuneRouterModule] Unsupported action \(type)")
        #endif
      }
    }
  }

}
