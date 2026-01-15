//
//  ZynthWebServer.swift
//  ZynthWebServer
//
//  Public interface for ZynthWebServer module
//

import Foundation
import ZynthKit

@objc(ZynthWebServer)
public class ZynthWebServer: NSObject {
  private static var moduleInstance: ZynthWebServerModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthWebServer] Module already initialized")
      return
    }

    let module = ZynthWebServerModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthWebServer] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
