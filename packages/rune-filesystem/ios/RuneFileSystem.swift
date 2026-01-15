//
//  RuneFileSystem.swift
//  RuneFileSystem
//
//  Public interface for RuneFileSystem module
//

import Foundation
import RuneKit

@objc(RuneFileSystem)
public class RuneFileSystem: NSObject {
  private static var moduleInstance: RuneFileSystemModule?

  @objc public static func initialize(with runtime: RuneRuntime) {
    guard moduleInstance == nil else {
      print("[RuneFileSystem] Module already initialized")
      return
    }

    let module = RuneFileSystemModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[RuneFileSystem] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
