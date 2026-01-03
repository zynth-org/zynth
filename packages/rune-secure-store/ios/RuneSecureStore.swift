//
//  RuneSecureStore.swift
//  RuneSecureStore
//
//  Public interface for RuneSecureStore module
//

import Foundation
import RuneKit

@objc(RuneSecureStore)
public class RuneSecureStore: NSObject {
  private static var moduleInstance: RuneSecureStoreModule?

  @objc public static func initialize(with runtime: RuneRuntime) {
    guard moduleInstance == nil else {
      print("[RuneSecureStore] Module already initialized")
      return
    }

    let module = RuneSecureStoreModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[RuneSecureStore] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
