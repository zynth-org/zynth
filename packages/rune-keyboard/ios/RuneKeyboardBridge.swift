//
//  RuneKeyboardBridge.swift
//  RuneKeyboard
//
//  Bridge module that exposes keyboard functionality to JavaScript
//  via the __modules.call() mechanism.
//

import Foundation
import RuneKit

final class RuneKeyboardBridge: NSObject, RuneModule {

  let name = "RuneKeyboard"
  private weak var keyboardModule: RuneKeyboardModule?

  init(keyboardModule: RuneKeyboardModule) {
    self.keyboardModule = keyboardModule
    super.init()
  }

  func call(method: String, args: Any?) throws -> Any? {
    print("[RuneKeyboardBridge] call(\(method))")
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
    print("[RuneKeyboardBridge] handleDismiss() invoked from JS")
    keyboardModule?.dismissKeyboard()
    return ["success": true]
  }

  private func handleGetState() -> [String: Any] {
    return ["success": true]
  }
}
