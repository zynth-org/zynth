import Foundation
import RuneKit
import UIKit

final class RuneRouterModule: NSObject, RuneModule, RuneSyncModule {
  let name: String = "RuneRouter"

  private weak var runtime: RuneRuntime?
  private weak var stackController: RNStackController?
  private var tabsHostController: RNTabsHostController?
  private let emitter: RuneRouterEmitter
  private var registeredScreens: [[String: Any]] = []
  private var beforeRemoveResolvers: [String: (Bool) -> Void] = [:]
  private let tabsRootRouteKey = "tabs-root"
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
    stackController.runtime = runtime
    stackController.bindRouterModule(self, emitter: emitter)
    if let runtime, let tabsHostController {
      tabsHostController.attachRuntime(runtime)
      tabsHostController.installRootSurface(runtime.rootView)
    }
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
        guard let self else { return }
        if key == self.tabsRootRouteKey {
          return
        }
        self.stackController?.applyOptions(for: key, options: options)
      }
      return ["result": "ok"]
    case "registerScreens":
      guard let dict = args as? [String: Any],
        let screens = dict["screens"] as? [[String: Any]]
      else { return ["error": "invalid_screens"] }
      registeredScreens = screens
      if screens.contains(where: { ($0["navigatorId"] as? String) == tabsRootRouteKey }) {
        DispatchQueue.main.async { [weak self] in
          _ = self?.ensureTabsRootHost()
        }
      }
      return ["result": "ok"]
    case "configureTabs":
      guard
        let dict = args as? [String: Any],
        let routeKey = dict["routeKey"] as? String,
        let config = dict["config"] as? [String: Any],
        let tabsConfig = TabBarConfiguration(dictionary: config)
      else { return ["error": "invalid_tabs"] }
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        if routeKey == self.tabsRootRouteKey {
          self.ensureTabsRootHost()?.configureTabs(configuration: tabsConfig)
        } else {
          self.stackController?.configureTabs(for: routeKey, configuration: tabsConfig)
        }
      }
      return ["result": "ok"]
    case "removeTabs":
      guard let dict = args as? [String: Any],
        let routeKey = dict["routeKey"] as? String
      else { return ["error": "invalid_route"] }
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        if routeKey == self.tabsRootRouteKey {
          self.tabsHostController?.removeTabs()
        } else {
          self.stackController?.removeTabs(for: routeKey)
        }
      }
      return ["result": "ok"]
    case "selectTab":
      guard
        let dict = args as? [String: Any],
        let routeKey = dict["routeKey"] as? String,
        let tabName = dict["tabName"] as? String
      else { return ["error": "invalid_tab"] }
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        if routeKey == self.tabsRootRouteKey {
          self.tabsHostController?.selectTab(named: tabName)
        } else {
          self.stackController?.selectTab(for: routeKey, name: tabName)
        }
      }
      return ["result": "ok"]
    case "resolveBeforeRemove":
      guard
        let dict = args as? [String: Any],
        let requestId = dict["requestId"] as? String,
        let cancelled = dict["cancelled"] as? Bool
      else { return ["error": "invalid_request"] }
      resolveBeforeRemove(requestId: requestId, cancelled: cancelled)
      return ["result": "ok"]
    case "screenRendered":
      guard let dict = args as? [String: Any],
        let rootId = dict["rootId"] as? Int
      else { return ["error": "invalid_root_id"] }
      DispatchQueue.main.async { [weak self] in
        self?.stackController?.notifyScreenRendered(surfaceId: rootId)
      }
      return ["result": "ok"]
    default:
      return ["error": "unknown_method"]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "getState":
      let state = tabsHostController?.currentStatePayload() ?? stackController?.currentStatePayload()
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

  func getOptions(for routeName: String) -> [String: Any]? {
    return registeredScreens.first(where: { ($0["name"] as? String) == routeName })?["options"] as? [String: Any]
  }

  private func resolveBeforeRemove(requestId: String, cancelled: Bool) {
    guard let completion = beforeRemoveResolvers.removeValue(forKey: requestId) else {
      return
    }
    completion(!cancelled)
  }

  private func ensureTabsRootHost() -> RNTabsHostController? {
    if let host = tabsHostController {
      return host
    }
    guard let runtime else {
      return nil
    }
    let host = RNTabsHostController(routeKey: tabsRootRouteKey, emitter: emitter)
    host.attachRuntime(runtime)
    host.installRootSurface(runtime.rootView)
    tabsHostController = host
    RuneRouterHost.installTabsHost(host)
    return host
  }

  private func handleDispatch(_ action: [String: Any]) {
    guard let type = action["type"] as? String else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if let tabsHost = self.tabsHostController {
        if type == "NAVIGATE" || type == "JUMP_TO" {
          if let payload = action["payload"] as? [String: Any],
            let name = payload["name"] as? String
          {
            tabsHost.selectTab(named: name)
          }
        }
        return
      }
      switch type {
      case "PUSH", "NAVIGATE":
        guard let payload = action["payload"] as? [String: Any],
          let name = payload["name"] as? String
        else { return }
        let params = payload["params"] as? [String: Any]
        let options = payload["options"] as? [String: Any]
        self.stackController?.push(routeName: name, params: params, options: options, animated: true)
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
        return
      }
    }
  }

}
