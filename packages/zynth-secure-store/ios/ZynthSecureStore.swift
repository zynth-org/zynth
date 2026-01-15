//
//  ZynthSecureStore.swift
//  ZynthSecureStore
//
//  Public interface for ZynthSecureStore module
//

import Foundation
import ZynthKit

@objc(ZynthSecureStore)
public class ZynthSecureStore: NSObject {
  private static var moduleInstance: ZynthSecureStoreModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthSecureStore] Module already initialized")
      return
    }

    let module = ZynthSecureStoreModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthSecureStore] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
