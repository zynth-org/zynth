//
//  {{MODULE_NAME_PASCAL}}Module.swift
//  Zynth{{MODULE_NAME_PASCAL}}
//
//  Native module implementation for {{MODULE_DESCRIPTION}}
//

import UIKit
import ZynthKit

@objc({{MODULE_NAME_PASCAL}}Module)
public class {{MODULE_NAME_PASCAL}}Module: NSObject {
  
  private weak var runtime: ZynthRuntime?
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
  
  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }
  
  @discardableResult
  @objc public static func initialize(with runtime: ZynthRuntime) -> {{MODULE_NAME_PASCAL}}Module {
    print("[{{MODULE_NAME_PASCAL}}] Initializing module")
    let module = {{MODULE_NAME_PASCAL}}Module(runtime: runtime)
    
    print("[{{MODULE_NAME_PASCAL}}] Registering bridge")
    module.registerBridge()
    
    print("[{{MODULE_NAME_PASCAL}}] Starting observation")
    module.startObserving()
    
    print("[{{MODULE_NAME_PASCAL}}] Module initialized and observing")
    return module
  }
  
  deinit {
    stopObserving()
  }
  
  // MARK: - Bridge
  
  private func registerBridge() {
    guard let runtime = runtime else { return }
    let bridge = {{MODULE_NAME_PASCAL}}Bridge(module: self)
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
      print("[{{MODULE_NAME_PASCAL}}] State unchanged, skipping update")
      return
    }
    
    print("[{{MODULE_NAME_PASCAL}}] State changed: value=\(newState.value) status=\(newState.status)")
    lastState = newState
    publishState(newState)
  }
  
  private func publishState(_ state: ModuleState) {
    guard let runtime = runtime else { return }
    runtime.emitEvent(name: "{{MODULE_NAME_PASCAL}}:change", payload: state.toDictionary())
  }
}

// MARK: - Bridge

final class {{MODULE_NAME_PASCAL}}Bridge: NSObject, ZynthModule, ZynthSyncModule {
  
  let name = "{{MODULE_NAME_PASCAL}}"
  private var module: {{MODULE_NAME_PASCAL}}Module?
  
  init(module: {{MODULE_NAME_PASCAL}}Module) {
    self.module = module
    super.init()
  }
  
  var constantsToExport: [String: Any]? {
    module?.getInitialState().toDictionary()
  }
  
  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    default:
      return ["error": "unsupported_method", "message": method]
    }
  }
  
  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getCurrentState":
      return module?.getInitialState().toDictionary()
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }
}
