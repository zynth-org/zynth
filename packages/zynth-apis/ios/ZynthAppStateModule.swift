import Foundation
import UIKit
import ZynthKit

private let appStateEventName = "zynth.appstate.change"

private enum AppLifecycleState: String {
  case active
  case background
  case inactive
}

@objc(ZynthAppStateModule)
final class ZynthAppStateModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "AppState"

  var exportedMethods: [String] {
    return ["current"]
  }

  private weak var runtime: ZynthRuntime?
  private var observers: [NSObjectProtocol] = []
  private var currentState: AppLifecycleState = .active

  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
    self.currentState = resolveCurrentState()
  }

  var constantsToExport: [String: Any]? {
    ["state": currentState.rawValue]
  }

  func initialize() {
    DispatchQueue.main.async { [weak self] in
      self?.startObserving()
    }
  }

  func invalidate() {
    DispatchQueue.main.async { [weak self] in
      self?.stopObserving()
    }
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "current":
      return ["result": ["state": currentState.rawValue]]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "current":
      return ["state": currentState.rawValue]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func startObserving() {
    stopObserving()
    updateState(resolveCurrentState())
    
    // Schedule a re-check to catch the startup transition (inactive -> active)
    // which might happen while JS is still initializing.
    DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.updateState(self.resolveCurrentState())
    }

    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.updateState(.active)
      }
    )
    observers.append(
      center.addObserver(
        forName: UIApplication.willResignActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.updateState(.inactive)
      }
    )
    observers.append(
      center.addObserver(
        forName: UIApplication.didEnterBackgroundNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.updateState(.background)
      }
    )
    observers.append(
      center.addObserver(
        forName: UIApplication.willEnterForegroundNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.updateState(.active)
      }
    )
  }

  private func stopObserving() {
    let center = NotificationCenter.default
    for observer in observers {
      center.removeObserver(observer)
    }
    observers.removeAll()
  }

  private func resolveCurrentState() -> AppLifecycleState {
    if Thread.isMainThread {
      return mapApplicationState(UIApplication.shared.applicationState)
    }

    var resolved: AppLifecycleState = .active
    DispatchQueue.main.sync {
      resolved = mapApplicationState(UIApplication.shared.applicationState)
    }
    return resolved
  }

  private func mapApplicationState(_ state: UIApplication.State) -> AppLifecycleState {
    switch state {
    case .active:
      return .active
    case .background:
      return .background
    case .inactive:
      return .inactive
    @unknown default:
      return .inactive
    }
  }

  private func updateState(_ nextState: AppLifecycleState) {
    guard currentState != nextState else {
      return
    }
    currentState = nextState
    runtime?.emitEvent(name: appStateEventName, payload: ["state": currentState.rawValue])
  }
}
