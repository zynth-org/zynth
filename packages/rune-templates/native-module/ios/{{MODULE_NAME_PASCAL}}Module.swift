//
//  {{MODULE_NAME_PASCAL}}Module.swift
//  Rune{{MODULE_NAME_PASCAL}}
//
//  Native module implementation for {{MODULE_DESCRIPTION}}
//

import UIKit
import RuneKit

@objc({{MODULE_NAME_PASCAL}}Module)
public class {{MODULE_NAME_PASCAL}}Module: NSObject {
  
  private weak var runtime: RuneRuntime?
  private var observers: [NSObjectProtocol] = []
  private var lastState: ModuleState?
  
  // MARK: - Data Model
  
  private struct ModuleState: Equatable {
    let value: Int
    let status: String
    let timestamp: TimeInterval
    
    func toJSON() -> String {
      """
      {
        "value": \(value),
        "status": "\(status)",
        "timestamp": \(timestamp)
      }
      """
    }
  }
  
  // MARK: - Lifecycle
  
  init(runtime: RuneRuntime) {
    self.runtime = runtime
    super.init()
  }
  
  @objc public static func initialize(with runtime: RuneRuntime) {
    print("[{{MODULE_NAME_PASCAL}}] Initializing module")
    let module = {{MODULE_NAME_PASCAL}}Module(runtime: runtime)
    
    print("[{{MODULE_NAME_PASCAL}}] Installing JS interface")
    module.installJSInterface()
    
    print("[{{MODULE_NAME_PASCAL}}] Starting observation")
    module.startObserving()
    
    print("[{{MODULE_NAME_PASCAL}}] Module initialized and observing")
  }
  
  deinit {
    stopObserving()
  }
  
  // MARK: - JS Interface
  
  private func installJSInterface() {
    guard let runtime = runtime else { return }
    
    let code = """
    (function() {
      const listeners = [];
      let currentState = null;
      
      globalThis.__{{MODULE_NAME_UPPER}}__ = {
        getInitialState: function() {
          return currentState;
        },
        addChangeListener: function(listener) {
          listeners.push(listener);
          return function() {
            const index = listeners.indexOf(listener);
            if (index >= 0) {
              listeners.splice(index, 1);
            }
          };
        },
        _updateState: function(state) {
          currentState = state;
          for (let i = 0; i < listeners.length; i++) {
            try {
              listeners[i](state);
            } catch (error) {
              console.error('[{{MODULE_NAME_PASCAL}}] Listener error:', error);
            }
          }
        }
      };
      
      console.log('[{{MODULE_NAME_PASCAL}}] Module installed');
    })();
    """
    
    evaluateJavaScript(code, in: runtime)
    
    // Provide initial state immediately
    updateState(force: true)
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
  
  private func updateState(force: Bool) {
    let newState = getCurrentState()
    
    // Skip if unchanged (unless forced)
    if !force, let last = lastState, last == newState {
      print("[{{MODULE_NAME_PASCAL}}] State unchanged, skipping update")
      return
    }
    
    print("[{{MODULE_NAME_PASCAL}}] State changed: value=\(newState.value) status=\(newState.status)")
    lastState = newState
    publishStateToJS(newState)
  }
  
  private func publishStateToJS(_ state: ModuleState) {
    guard let runtime = runtime else { return }
    
    let stateJSON = state.toJSON()
    print("[{{MODULE_NAME_PASCAL}}] Publishing state to JS:", stateJSON)
    
    let code = """
    (function() {
      if (globalThis.__{{MODULE_NAME_UPPER}}__) {
        globalThis.__{{MODULE_NAME_UPPER}}__._updateState(\(stateJSON));
        console.log('[{{MODULE_NAME_PASCAL}}] State updated:', \(stateJSON));
      } else {
        console.warn('[{{MODULE_NAME_PASCAL}}] Module not installed, cannot update state');
      }
    })();
    """
    
    evaluateJavaScript(code, in: runtime)
  }
  
  // MARK: - Helper
  
  private func evaluateJavaScript(_ code: String, in runtime: RuneRuntime) {
    // Use Mirror reflection to access internal runtime adapter
    let mirror = Mirror(reflecting: runtime)
    for child in mirror.children {
      if child.label == "runtime",
         let adapter = child.value as? JSRuntimeAdapter {
        adapter.evaluate(code: code)
        return
      }
    }
  }
}
