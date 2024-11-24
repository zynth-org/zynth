import Foundation

public enum RuneModuleError: LocalizedError {
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

public protocol RuneModule {
  var name: String { get }
  func call(method: String, args: Any?) throws -> Any?
  func initialize()
  func invalidate()
}

public extension RuneModule {
    func initialize() {}
    func invalidate() {}
}

public protocol RuneSyncModule {
  func callSync(method: String, args: Any?) throws -> Any?
}

public final class RuneModuleRegistry {
  private var modules: [String: RuneModule] = [:]

  public init() {}

  public func register(_ module: RuneModule) {
    modules[module.name] = module
    module.initialize()
  }

  public func destroy() {
    for module in modules.values {
      module.invalidate()
    }
    modules.removeAll()
  }

  public func call(_ name: String, method: String, args: Any?) throws -> Any? {
    guard let module = modules[name] else {
      throw RuneModuleError.moduleNotFound(name)
    }
    return try module.call(method: method, args: args)
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
