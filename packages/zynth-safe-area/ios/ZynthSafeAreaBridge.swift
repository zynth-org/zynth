//
//  ZynthSafeAreaBridge.swift
//  ZynthSafeArea
//
//  Bridge module that exposes safe area metrics to JavaScript
//  via NativeConstants and ZynthNativeEmitter.
//

import Foundation
import ZynthKit

final class ZynthSafeAreaBridge: NSObject, ZynthModule, ZynthSyncModule {

  let name = "ZynthSafeArea"
  private weak var module: ZynthSafeAreaModule?

  init(module: ZynthSafeAreaModule) {
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
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }
}
