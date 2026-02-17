//
//  ZynthKeyboardBridge.swift
//  ZynthKeyboard
//
//  Bridge module that exposes keyboard functionality to JavaScript
//  via the __modules.call() mechanism.
//

import Foundation
import ZynthKit

final class ZynthKeyboardBridge: NSObject, ZynthModule {

  let name = "ZynthKeyboard"
  private weak var keyboardModule: ZynthKeyboardModule?

  var exportedMethods: [String] {
    return ["dismiss", "getState"]
  }

  var constantsToExport: [String: Any]? {
    keyboardModule?.getInitialState().toDictionary()
  }

  init(keyboardModule: ZynthKeyboardModule) {
    self.keyboardModule = keyboardModule
    super.init()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "dismiss":
      return ["result": handleDismiss()]
    case "getState":
      return ["result": handleGetState()]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func handleDismiss() -> [String: Any] {
    keyboardModule?.dismissKeyboard()
    return ["success": true]
  }

  private func handleGetState() -> [String: Any] {
    return ["success": true]
  }
}
