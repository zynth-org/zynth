//
//  RuneHaptics.swift
//  RuneHaptics
//
//  Public interface for RuneHaptics module
//

import Foundation
import RuneKit

@objc(RuneHaptics)
public class RuneHaptics: NSObject {
  private static var isInstalled = false

  @objc public static func initialize(with runtime: RuneRuntime) {
    if isInstalled {
      print("[RuneHaptics] Module already initialized")
      return
    }

    runtime.installModules([RuneHapticsBridge()])
    isInstalled = true
    print("[RuneHaptics] Module initialized")
  }
}
