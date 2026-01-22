import Foundation

public enum ZynthModuleError: LocalizedError {
  case moduleNotFound(String)
  case syncNotSupported(module: String, method: String)
  case runtimeDeallocated

  public var errorDescription: String? {
    switch self {
    case .moduleNotFound(let module):
      return "Module \(module) not found"
    case .syncNotSupported(let module, let method):
      return "Module \(module) does not support synchronous method \(method)"
    case .runtimeDeallocated:
      return "Runtime deallocated"
    }
  }
}

public protocol ZynthModule {
  var name: String { get }
  var constantsToExport: [String: Any]? { get }
  func call(method: String, args: Any?) throws -> Any?
  func initialize()
  func invalidate()
}

public extension ZynthModule {
  var constantsToExport: [String: Any]? { nil }
  func initialize() {}
  func invalidate() {}
}

public protocol ZynthSyncModule {
  func callSync(method: String, args: Any?) throws -> Any?
}

final class ZynthModuleRegistry: NSObject, ZynthModuleBridge {
  private var modules: [String: ZynthModule] = [:]

  override init() {}

  func register(_ module: ZynthModule) {
    modules[module.name] = module
    module.initialize()
  }

  func destroy() {
    for module in modules.values {
      module.invalidate()
    }
    modules.removeAll()
  }

  func exportedConstants() -> [String: Any] {
    var constants: [String: Any] = [:]
    for module in modules.values {
      if let moduleConstants = module.constantsToExport {
        constants[module.name] = moduleConstants
      }
    }
    return constants
  }

  func call(_ name: String, method: String, args: Any?) throws -> Any? {
    guard let module = modules[name] else {
      throw ZynthModuleError.moduleNotFound(name)
    }
    return try module.call(method: method, args: args)
  }

  func callSync(_ name: String, method: String, args: Any?) throws -> Any? {
    guard let module = modules[name] else {
      throw ZynthModuleError.moduleNotFound(name)
    }
    guard let syncModule = module as? ZynthSyncModule else {
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
    return try syncModule.callSync(method: method, args: args)
  }
  
  // ZynthModuleBridge implementation
  func callModule(_ moduleName: String, method methodName: String, args: Any?) -> Any? {
    do {
      return try call(moduleName, method: methodName, args: args)
    } catch {
      print("[ZynthModuleRegistry] callModule error: \(error)")
      return ["error": error.localizedDescription]
    }
  }
  
  func callModuleSync(_ moduleName: String, method methodName: String, args: Any?) -> Any? {
    do {
      return try callSync(moduleName, method: methodName, args: args)
    } catch {
      print("[ZynthModuleRegistry] callModuleSync error: \(error)")
      return ["error": error.localizedDescription]
    }
  }
}
