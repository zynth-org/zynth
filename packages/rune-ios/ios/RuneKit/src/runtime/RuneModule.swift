import Foundation

public enum RuneModuleError: LocalizedError {
  case moduleNotFound(String)
  case syncNotSupported(module: String, method: String)
  case runtimeDeallocated

  public var errorDescription: String? {
    switch self {
    case let .moduleNotFound(module):
      return "Module \(module) not found"
    case let .syncNotSupported(module, method):
      return "Module \(module) does not support synchronous method \(method)"
    case .runtimeDeallocated:
      return "Runtime deallocated"
    }
  }
}

public protocol RuneModule {
  var name: String { get }
  func call(method: String, argsJSON: String) -> String
}

public protocol RuneSyncModule {
  func callSync(method: String, args: Any?) throws -> Any?
}

public final class RuneModuleRegistry {
  private var modules: [String: RuneModule] = [:]

  public init() {}

  public func register(_ module: RuneModule) {
    modules[module.name] = module
  }

  public func call(_ name: String, method: String, argsJSON: String) -> String {
    guard let module = modules[name] else {
      print("[RuneModuleRegistry] Missing module \(name)")
      return "{}"
    }
    return module.call(method: method, argsJSON: argsJSON)
  }

  public func callSync(_ name: String, method: String, args: Any?) throws -> Any? {
    guard let module = modules[name] else {
      throw RuneModuleError.moduleNotFound(name)
    }

    guard let syncModule = module as? RuneSyncModule else {
      throw RuneModuleError.syncNotSupported(module: name, method: method)
    }

    return try syncModule.callSync(method: method, args: args)
  }
}
