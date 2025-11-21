//
//  RuneSafeAreaBridge.swift
//  RuneSafeArea
//
//  Bridge module that exposes safe area metrics to JavaScript
//  via NativeConstants and RuneNativeEmitter.
//

import Foundation
import RuneKit

final class RuneSafeAreaBridge: NSObject, RuneModule, RuneSyncModule {

  let name = "RuneSafeArea"
  private weak var module: RuneSafeAreaModule?

  init(module: RuneSafeAreaModule) {
    self.module = module
    super.init()
  }

  var constantsToExport: [String: Any]? {
    module?.getInitialMetrics().toDictionary()
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    default:
      return ["error": "unsupported_method", "message": method]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "getCurrentMetrics":
      return module?.getInitialMetrics().toDictionary()
    default:
      throw RuneModuleError.syncNotSupported(module: name, method: method)
    }
  }
}
