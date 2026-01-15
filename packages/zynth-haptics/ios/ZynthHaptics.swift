//
//  ZynthHaptics.swift
//  ZynthHaptics
//
//  Public interface for ZynthHaptics module
//

import Foundation
import ZynthKit

@objc(ZynthHaptics)
public class ZynthHaptics: NSObject {
  private static var isInstalled = false

  @objc public static func initialize(with runtime: ZynthRuntime) {
    if isInstalled {
      print("[ZynthHaptics] Module already initialized")
      return
    }

    runtime.installModules([ZynthHapticsBridge()])
    isInstalled = true
    print("[ZynthHaptics] Module initialized")
  }
}
