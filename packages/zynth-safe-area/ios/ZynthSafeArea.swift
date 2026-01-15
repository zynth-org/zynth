//
//  ZynthSafeArea.swift
//  ZynthSafeArea
//
//  Public interface for ZynthSafeArea module
//

import Foundation
import ZynthKit

@objc(ZynthSafeArea)
public class ZynthSafeArea: NSObject {
  
  private static var moduleInstance: ZynthSafeAreaModule?
  
  /// Initialize the safe area module with a ZynthRuntime instance
  /// Should be called during app initialization before the JS bundle loads
  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthSafeArea] Module already initialized")
      return
    }
    
    // Use the static initialize method from ZynthSafeAreaModule
    moduleInstance = ZynthSafeAreaModule.initialize(with: runtime)
    print("[ZynthSafeArea] Module initialized")
  }
  
  /// Clean up the module (called during app teardown)
  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
