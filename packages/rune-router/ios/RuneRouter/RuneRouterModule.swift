import Foundation
import RuneKit
import UIKit

public final class RuneRouterModule: NSObject, RuneModule, RuneSyncModule {
  public let name: String = "RuneRouter"

  private weak var runtime: RuneRuntime?
  private weak var stackController: RNStackController?
  private var tabsHostController: RNTabsHostController?
  private var bottomSheetControllers = NSHashTable<AnyObject>.weakObjects()
  private let emitter: RuneRouterEmitter
  private var registeredScreens: [[String: Any]] = []
  private var beforeRemoveResolvers: [String: (Bool) -> Void] = [:]
  private let tabsRootRouteKey = "tabs-root"
  var sharedEmitter: RuneRouterEmitter { emitter }

  public init(runtime: RuneRuntime, stackController: RNStackController) {
    self.runtime = runtime
    self.stackController = stackController
    self.emitter = RuneRouterEmitter(runtime: runtime)
    super.init()
    stackController.runtime = runtime
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

  func registerBottomSheet(_ controller: Any) {
    bottomSheetControllers.add(controller as AnyObject)
  }

  public func call(method: String, args: Any?) throws -> Any? {
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
        if #available(iOS 16.0, *) {
             let sheets = self.bottomSheetControllers.allObjects.compactMap { $0 as? RNBottomSheetController }
             if let owner = sheets.first(where: { $0.hasRoute(withKey: key) }) {
                 owner.applyOptions(for: key, options: options)
                 return
             }
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
        if #available(iOS 16.0, *) {
            for controller in self?.bottomSheetControllers.allObjects ?? [] {
                (controller as? RNBottomSheetController)?.notifyScreenRendered(surfaceId: rootId)
            }
        }
      }
      return ["result": "ok"]
    default:
      return ["error": "unknown_method"]
    }
  }

  public func callSync(method: String, args: Any?) throws -> Any? {
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

  func getNavigatorId(for routeName: String) -> String? {
    return registeredScreens.first(where: { ($0["name"] as? String) == routeName })?["navigatorId"] as? String
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
      
      // print("[RuneRouter] Dispatch: \(type) payload=\(action["payload"] ?? "nil") source=\(action["source"] ?? "nil")")
      
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
      
      var handled = false
      if #available(iOS 16.0, *) {
          let sheets = self.bottomSheetControllers.allObjects.compactMap { $0 as? RNBottomSheetController }
          
          if type == "RESET" {
              guard let state = action["state"] as? [String: Any] else { return }
              if let navType = state["type"] as? String, navType == "bottomSheet" {
                  let key = state["key"] as? String
                  
                  // 1. Check if we already have this navigator
                  if let key, let target = sheets.first(where: { $0.navigatorId == key }) {
                      target.reset(using: state, animated: true)
                      handled = true
                  } else {
                      // 2. Create new BottomSheet Navigator
                      let config = state["config"] as? [String: Any]
                      let sheet = RNBottomSheetController(config: config)
                      
                      if let runtime { sheet.runtime = runtime }
                      sheet.emitter = self.emitter
                      sheet.routerModule = self
                      sheet.navigatorId = key
                      
                      self.registerBottomSheet(sheet)
                      
                      sheet.modalPresentationStyle = .overFullScreen
                      sheet.reset(using: state, animated: false) // Set initial state
                      
                      // Present from top-most controller
                      // We prefer using stackController as base, but we should find the visible top
                      if let top = self.stackController?.presentedViewController {
                           top.present(sheet, animated: true)
                      } else {
                           self.stackController?.present(sheet, animated: true)
                      }
                      handled = true
                  }
              }
          } else if let source = action["source"] as? String,
                    let owner = sheets.first(where: { $0.hasRoute(withKey: source) }) {
               // print("[RuneRouter] Handled by source: \(source)")
               switch type {
                 case "PUSH", "NAVIGATE":
                    guard let payload = action["payload"] as? [String: Any], let name = payload["name"] as? String else { return }
                    let params = payload["params"] as? [String: Any]
                    let options = payload["options"] as? [String: Any]
                    owner.push(routeName: name, params: params, options: options, animated: true)
                 case "POP":
                    let payload = action["payload"] as? [String: Any]
                    let count = payload?["count"] as? Int ?? 1
                    owner.pop(count: count, animated: true)
                 case "SET_PARAMS":
                    guard let payload = action["payload"] as? [String: Any] else { return }
                    owner.setParams(for: source, params: payload)
                 default:
                    break
               }
               handled = true
          }
          
          // If not handled by source, check if target belongs to a known bottom sheet
          if !handled && (type == "PUSH" || type == "NAVIGATE") {
             if let payload = action["payload"] as? [String: Any],
                let name = payload["name"] as? String {
                
                let targetId = getNavigatorId(for: name)
                let sheet = sheets.first(where: { $0.navigatorId == targetId })
                
                // print("[RuneRouter] Lookup targetId: \(targetId ?? "nil") for \(name). Found sheet: \(sheet != nil)")
                // print("[RuneRouter] Registered screens count: \(self.registeredScreens.count)")
                // print("[RuneRouter] Sheets count: \(sheets.count)")

                if let targetId, let sheet {
                     let params = payload["params"] as? [String: Any]
                     let options = payload["options"] as? [String: Any]
                     sheet.push(routeName: name, params: params, options: options, animated: true)
                     handled = true
                }
             }
          }
      }
      
      if handled { return }
      
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
