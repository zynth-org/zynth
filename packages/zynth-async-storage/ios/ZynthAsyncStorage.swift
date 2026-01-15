//
//  ZynthAsyncStorage.swift
//  ZynthAsyncStorage
//
//  Public interface for ZynthAsyncStorage module
//

import Foundation
import ZynthKit

@objc(ZynthAsyncStorage)
public class ZynthAsyncStorage: NSObject {
  private static var moduleInstance: ZynthAsyncStorageModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthAsyncStorage] Module already initialized")
      return
    }

    let module = ZynthAsyncStorageModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthAsyncStorage] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
