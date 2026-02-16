//
//  ZynthSplashScreenBridge.swift
//  ZynthSplashScreen
//
//  Bridge module that exposes splash screen controls to JavaScript
//  via the __modules.call() mechanism.
//

import Foundation
import ZynthKit

final class ZynthSplashScreenBridge: NSObject, ZynthModule, ZynthSyncModule {

  let name = "ZynthSplashScreen"

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "preventAutoHide":
      return ZynthSplashScreen.preventAutoHideJS()
    case "hide":
      return ZynthSplashScreen.hideJS()
    default:
      return ["error": "unsupported_method", "message": method]
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    return try call(method: method, args: args)
  }
}
