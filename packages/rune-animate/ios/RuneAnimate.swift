//
//  RuneAnimate.swift
//  RuneAnimate
//
//  Public interface for RuneAnimate module
//

import Foundation
import RuneKit

@objc(RuneAnimate)
public final class RuneAnimate: NSObject {
  private static var isInstalled = false

  @objc public static func initialize(with runtime: RuneRuntime) {
    if isInstalled {
      print("[RuneAnimate] Module already initialized")
      return
    }

    runtime.installModules([RuneAnimateBridge(runtime: runtime)])
    isInstalled = true
    print("[RuneAnimate] Module initialized")
  }
}
