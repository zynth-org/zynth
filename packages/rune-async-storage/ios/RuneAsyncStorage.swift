//
//  RuneAsyncStorage.swift
//  RuneAsyncStorage
//
//  Public interface for RuneAsyncStorage module
//

import Foundation
import RuneKit

@objc(RuneAsyncStorage)
public class RuneAsyncStorage: NSObject {
  private static var moduleInstance: RuneAsyncStorageModule?

  @objc public static func initialize(with runtime: RuneRuntime) {
    guard moduleInstance == nil else {
      print("[RuneAsyncStorage] Module already initialized")
      return
    }

    let module = RuneAsyncStorageModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[RuneAsyncStorage] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
