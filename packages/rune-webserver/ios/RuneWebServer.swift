//
//  RuneWebServer.swift
//  RuneWebServer
//
//  Public interface for RuneWebServer module
//

import Foundation
import RuneKit

@objc(RuneWebServer)
public class RuneWebServer: NSObject {
  private static var moduleInstance: RuneWebServerModule?

  @objc public static func initialize(with runtime: RuneRuntime) {
    guard moduleInstance == nil else {
      print("[RuneWebServer] Module already initialized")
      return
    }

    let module = RuneWebServerModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[RuneWebServer] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
