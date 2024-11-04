import Foundation

public protocol RuneModule {
  var name: String { get }
  func call(method: String, argsJSON: String) -> String
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
}
