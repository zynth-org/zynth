//
//  RuneKeyboard.swift
//  RuneKeyboard
//
//  Public interface for RuneKeyboard module
//

import Foundation
import RuneKit

@objc(RuneKeyboard)
public class RuneKeyboard: NSObject {
  
  private static var moduleInstance: RuneKeyboardModule?
  
  /// Initialize the keyboard module with a RuneRuntime instance
  /// Should be called during app initialization before the JS bundle loads
  @objc public static func initialize(with runtime: RuneRuntime) {
    guard moduleInstance == nil else {
      print("[RuneKeyboard] Module already initialized")
      return
    }
    
    // Use the static initialize method from RuneKeyboardModule
    moduleInstance = RuneKeyboardModule.initialize(with: runtime)
    print("[RuneKeyboard] Module initialized")
  }
  
  /// Clean up the module (called during app teardown)
  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
