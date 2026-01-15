//
//  ZynthKeyboard.swift
//  ZynthKeyboard
//
//  Public interface for ZynthKeyboard module
//

import Foundation
import ZynthKit

@objc(ZynthKeyboard)
public class ZynthKeyboard: NSObject {
  
  private static var moduleInstance: ZynthKeyboardModule?
  
  /// Initialize the keyboard module with a ZynthRuntime instance
  /// Should be called during app initialization before the JS bundle loads
  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthKeyboard] Module already initialized")
      return
    }
    
    // Use the static initialize method from ZynthKeyboardModule
    moduleInstance = ZynthKeyboardModule.initialize(with: runtime)
    print("[ZynthKeyboard] Module initialized")
  }
  
  /// Clean up the module (called during app teardown)
  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
