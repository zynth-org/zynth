//
//  RuneSafeArea.swift
//  RuneSafeArea
//
//  Public interface for RuneSafeArea module
//

import Foundation
import RuneKit

@objc(RuneSafeArea)
public class RuneSafeArea: NSObject {
  
  private static var moduleInstance: RuneSafeAreaModule?
  
  /// Initialize the safe area module with a RuneRuntime instance
  /// Should be called during app initialization before the JS bundle loads
  @objc public static func initialize(with runtime: RuneRuntime) {
    guard moduleInstance == nil else {
      print("[RuneSafeArea] Module already initialized")
      return
    }
    
    // Use the static initialize method from RuneSafeAreaModule
    RuneSafeAreaModule.initialize(with: runtime)
    print("[RuneSafeArea] Module initialized")
  }
  
  /// Clean up the module (called during app teardown)
  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
