import Foundation

public enum ZynthModuleError: LocalizedError {
  case moduleNotFound(String)
  case syncNotSupported(module: String, method: String)
  case methodNotExported(module: String, method: String)
  case runtimeDeallocated
  case invalidSession
  case invalidNonce

  public var errorDescription: String? {
    switch self {
    case .moduleNotFound(let module):
      return "Module \(module) not found"
    case .syncNotSupported(let module, let method):
      return "Module \(module) does not support synchronous method \(method)"
    case .methodNotExported(let module, let method):
      return "Method \(method) is not exported by module \(module)"
    case .runtimeDeallocated:
      return "Runtime deallocated"
    case .invalidSession:
      return "Invalid bridge session"
    case .invalidNonce:
      return "Invalid nonce (replay attack detected)"
    }
  }
}

public protocol ZynthModule {
  var name: String { get }
  var constantsToExport: [String: Any]? { get }
  var exportedMethods: [String] { get }
  var protectedMethods: [String] { get }
  func call(method: String, args: ZynthArgs) throws -> Any?
  func initialize()
  func invalidate()
}

public extension ZynthModule {
  var constantsToExport: [String: Any]? { nil }
  var exportedMethods: [String] { [] }
  var protectedMethods: [String] { [] }
  func initialize() {}
  func invalidate() {}
}

public protocol ZynthSyncModule {
  func callSync(method: String, args: ZynthArgs) throws -> Any?
}

final class ZynthModuleRegistry: NSObject, ZynthModuleBridge {
  private var modules: [String: ZynthModule] = [:]
  private var lastNonce: Int64 = 0
  private var bridgeSessionId: String?
  private let queue = DispatchQueue(label: "dev.zynth.moduleRegistry")

  override init() {
      super.init()
  }
  
  func setSessionId(_ sessionId: String) {
      queue.sync {
          self.bridgeSessionId = sessionId
      }
  }

  private func validateNonce(_ args: ZynthArgs) throws {
    // Note: This must be called from within the queue
    guard let session = self.bridgeSessionId else { 
        throw ZynthModuleError.invalidSession
    }
    
    let sessionId = try args.string("bridgeSessionId")
    let nonce = try args.int64("nonce")
    
    guard sessionId == session else {
        throw ZynthModuleError.invalidSession
    }
    
    guard nonce > self.lastNonce else {
        throw ZynthModuleError.invalidNonce
    }
    
    self.lastNonce = nonce
  }

  func register(_ module: ZynthModule) {
    queue.sync {
        modules[module.name] = module
    }
    module.initialize()
  }

  func destroy() {
    queue.sync {
        for module in modules.values {
          module.invalidate()
        }
        modules.removeAll()
    }
  }

  func exportedConstants() -> [String: Any] {
    return queue.sync {
        var constants: [String: Any] = [:]
        for module in modules.values {
          if let moduleConstants = module.constantsToExport {
            constants[module.name] = moduleConstants
          }
        }
        return constants
    }
  }

  func call(_ name: String, method: String, args: Any?) throws -> Any? {
    let module: ZynthModule? = queue.sync { modules[name] }
    guard let module = module else {
      throw ZynthModuleError.moduleNotFound(name)
    }
    guard module.exportedMethods.contains(method) else {
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
    let zynthArgs = ZynthArgs(args)
    if module.protectedMethods.contains(method) {
      try queue.sync { try validateNonce(zynthArgs) }
    }
    return try module.call(method: method, args: zynthArgs)
  }

  func callSync(_ name: String, method: String, args: Any?) throws -> Any? {
    let module: ZynthModule? = queue.sync { modules[name] }
    guard let module = module else {
      throw ZynthModuleError.moduleNotFound(name)
    }
    guard module.exportedMethods.contains(method) else {
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
    guard let syncModule = module as? ZynthSyncModule else {
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
    let zynthArgs = ZynthArgs(args)
    if module.protectedMethods.contains(method) {
      try queue.sync { try validateNonce(zynthArgs) }
    }
    return try syncModule.callSync(method: method, args: zynthArgs)
  }
  
  // ZynthModuleBridge implementation
  func callModule(_ moduleName: String, method methodName: String, args: Any?) -> Any? {
    do {
      return try call(moduleName, method: methodName, args: args)
    } catch {
      let sanitized = ZynthErrorMapper.sanitize(error)
      var payload: [String: Any] = ["error": sanitized.code, "message": sanitized.publicMessage]
      if let debugDetails = sanitized.debugDetails, !debugDetails.isEmpty {
        payload["details"] = debugDetails
      }
      return payload
    }
  }
  
  func callModuleSync(_ moduleName: String, method methodName: String, args: Any?) -> Any? {
    do {
      return try callSync(moduleName, method: methodName, args: args)
    } catch {
      let sanitized = ZynthErrorMapper.sanitize(error)
      var payload: [String: Any] = ["error": sanitized.code, "message": sanitized.publicMessage]
      if let debugDetails = sanitized.debugDetails, !debugDetails.isEmpty {
        payload["details"] = debugDetails
      }
      return payload
    }
  }
}
