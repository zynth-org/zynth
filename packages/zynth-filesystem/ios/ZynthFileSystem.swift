//
//  ZynthFileSystem.swift
//  ZynthFileSystem
//
//  Public interface for ZynthFileSystem module
//

import Foundation
import ZynthKit

@objc(ZynthFileSystem)
public class ZynthFileSystem: NSObject {
  private static var moduleInstance: ZynthFileSystemModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthFileSystem] Module already initialized")
      return
    }

    let module = ZynthFileSystemModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthFileSystem] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
