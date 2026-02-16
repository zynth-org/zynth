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
  var constantsToExport: [String: Any]? {
    keyboardModule?.getInitialState().toDictionary()
  }

  init(keyboardModule: ZynthKeyboardModule) {
    self.keyboardModule = keyboardModule
    super.init()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    print("[ZynthKeyboardBridge] call(\(method))")
    switch method {
    case "dismiss":
      return handleDismiss()
    case "getState":
      return handleGetState()
    default:
      return ["error": "unsupported_method", "message": method]
    }
  }

  private func handleDismiss() -> [String: Any] {
    print("[ZynthKeyboardBridge] handleDismiss() invoked from JS")
    keyboardModule?.dismissKeyboard()
    return ["success": true]
  }

  private func handleGetState() -> [String: Any] {
    return ["success": true]
  }
}
