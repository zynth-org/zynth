//
//  RuneSplashScreenBridge.swift
//  RuneSplashScreen
//
//  Bridge module that exposes splash screen controls to JavaScript
//  via the __modules.call() mechanism.
//

import Foundation
import RuneKit

final class RuneSplashScreenBridge: NSObject, RuneModule, RuneSyncModule {

  let name = "RuneSplashScreen"

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "preventAutoHide":
      return RuneSplashScreen.preventAutoHideJS()
    case "hide":
      return RuneSplashScreen.hideJS()
    default:
      return ["error": "unsupported_method", "message": method]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    return try call(method: method, args: args)
  }
}
