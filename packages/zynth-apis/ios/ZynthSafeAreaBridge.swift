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

  var exportedMethods: [String] {
    return ["refresh", "getCurrentMetrics"]
  }

  private let module: ZynthSafeAreaModule

  init(module: ZynthSafeAreaModule) {
    self.module = module
    super.init()
  }

  var constantsToExport: [String: Any]? {
    module.getInitialMetrics().toDictionary()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "refresh":
      module.refreshMetrics()
      return ["result": true]
    case "getCurrentMetrics":
      return ["result": module.getInitialMetrics().toDictionary()]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getCurrentMetrics":
      return module.getInitialMetrics().toDictionary()
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }
}
