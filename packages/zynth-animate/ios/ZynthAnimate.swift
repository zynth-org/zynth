//
//  ZynthAnimate.swift
//  ZynthAnimate
//
//  Public interface for ZynthAnimate module
//

import Foundation
import ZynthKit

private enum ZynthAnimateLogs {
  static let isVerboseEnabled: Bool = {
    #if DEBUG
      guard
        let rawValue = ProcessInfo.processInfo.environment["ZYNTH_ANIMATE_VERBOSE_LOGS"]?
          .trimmingCharacters(in: .whitespacesAndNewlines)
          .lowercased()
      else {
        return false
      }
      return rawValue == "1" || rawValue == "true" || rawValue == "yes"
    #else
      return false
    #endif
  }()

  static func debug(_ message: @autoclosure () -> String) {
    guard isVerboseEnabled else { return }
    print(message())
  }
}

@objc(ZynthAnimate)
public final class ZynthAnimate: NSObject {
  private static var isInstalled = false

  @objc public static func initialize(with runtime: ZynthRuntime) {
    if isInstalled {
      ZynthAnimateLogs.debug("[ZynthAnimate] Module already initialized")
      return
    }

    runtime.installModules([ZynthAnimateBridge(runtime: runtime)])
    isInstalled = true
    ZynthAnimateLogs.debug("[ZynthAnimate] Module initialized")
  }
}
