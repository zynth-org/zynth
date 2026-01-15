//
//  ZynthAnimate.swift
//  ZynthAnimate
//
//  Public interface for ZynthAnimate module
//

import Foundation
import ZynthKit

@objc(ZynthAnimate)
public final class ZynthAnimate: NSObject {
  private static var isInstalled = false

  @objc public static func initialize(with runtime: ZynthRuntime) {
    if isInstalled {
      print("[ZynthAnimate] Module already initialized")
      return
    }

    runtime.installModules([ZynthAnimateBridge(runtime: runtime)])
    isInstalled = true
    print("[ZynthAnimate] Module initialized")
  }
}
