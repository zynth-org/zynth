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

  var exportedMethods: [String] {
    return ["preventAutoHide", "hide"]
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "preventAutoHide":
      return ["result": ZynthSplashScreen.preventAutoHideJS()]
    case "hide":
      return ["result": ZynthSplashScreen.hideJS()]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    return try call(method: method, args: args)
  }
}
