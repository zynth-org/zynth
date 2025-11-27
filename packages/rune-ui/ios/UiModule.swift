//
//  UiModule.swift
//  RuneUi
//
//  Native module implementation for Easy to use UI Module
//

import UIKit
import RuneKit

@objc(UiModule)
public class UiModule: NSObject {
  
  private weak var runtime: RuneRuntime?
  private var observers: [NSObjectProtocol] = []
  private var lastState: ModuleState?
  
  // MARK: - Data Model
  
  struct ModuleState: Equatable {
    let value: Int
    let status: String
    let timestamp: TimeInterval
    
    func toDictionary() -> [String: Any] {
      [
        "value": value,
        "status": status,
        "timestamp": timestamp,
      ]
    }
  }
  
  // MARK: - Lifecycle
  
  init(runtime: RuneRuntime) {
    self.runtime = runtime
    super.init()
  }
  
  @discardableResult
  @objc public static func initialize(with runtime: RuneRuntime) -> UiModule {
    print("[Ui] Initializing module")
    let module = UiModule(runtime: runtime)
    
    print("[Ui] Registering bridge")
    module.registerBridge()
    
    print("[Ui] Starting observation")
    module.startObserving()
    
    print("[Ui] Module initialized and observing")
    return module
  }
  
  deinit {
    stopObserving()
  }
  
  // MARK: - Bridge
  
  private func registerBridge() {
    guard let runtime = runtime else { return }
    let bridge = UiBridge(module: self)
    runtime.installModules([bridge])
  }
  
  // MARK: - Observation
  
  private func startObserving() {
    // TODO: Add your platform observers here
    // Example: NotificationCenter observers, KVO, delegates, etc.
    
    // Example observer:
    // let observer = NotificationCenter.default.addObserver(
    //   forName: UIApplication.didBecomeActiveNotification,
    //   object: nil,
    //   queue: .main
    // ) { [weak self] _ in
    //   self?.updateState(force: false)
    // }
    // observers.append(observer)
    
    // Provide initial state
    updateState(force: true)
  }
  
  private func stopObserving() {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
  }
  
  // MARK: - State Management
  
  private func getCurrentState() -> ModuleState {
    // TODO: Implement your state calculation logic
    // This is just an example
    return ModuleState(
      value: Int.random(in: 0...100),
      status: "active",
      timestamp: Date().timeIntervalSince1970
    )
  }
  
  func getInitialState() -> ModuleState {
    return lastState ?? getCurrentState()
  }
  
  private func updateState(force: Bool) {
    let newState = getCurrentState()
    
    // Skip if unchanged (unless forced)
    if !force, let last = lastState, last == newState {
      print("[Ui] State unchanged, skipping update")
      return
    }
    
    print("[Ui] State changed: value=\(newState.value) status=\(newState.status)")
    lastState = newState
    publishState(newState)
  }
  
  private func publishState(_ state: ModuleState) {
    guard let runtime = runtime else { return }
    runtime.emitEvent(name: "Ui:change", payload: state.toDictionary())
  }
}

// MARK: - Bridge

final class UiBridge: NSObject, RuneModule, RuneSyncModule {
  
  let name = "Ui"
  private weak var module: UiModule?
  
  init(module: UiModule) {
    self.module = module
    super.init()
  }
  
  var constantsToExport: [String: Any]? {
    module?.getInitialState().toDictionary()
  }
  
  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    default:
      return ["error": "unsupported_method", "message": method]
    }
  }
  
  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "getCurrentState":
      return module?.getInitialState().toDictionary()
    default:
      throw RuneModuleError.syncNotSupported(module: name, method: method)
    }
  }
}
