import Foundation
import ObjectiveC

private var zynthModuleRegistryKey: UInt8 = 0

public extension ZynthRuntime {
  private var zynthModuleRegistry: ZynthModuleRegistry {
    if let registry = objc_getAssociatedObject(self, &zynthModuleRegistryKey) as? ZynthModuleRegistry {
      return registry
    }
    let registry = ZynthModuleRegistry()
    objc_setAssociatedObject(self, &zynthModuleRegistryKey, registry, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    return registry
  }

  func installModules(_ modules: [ZynthModule]) {
    for module in modules {
      zynthModuleRegistry.register(module)
    }
  }

  func emitEvent(name: String, payload: Any?) {
    emitEvent(withName: name, payload: payload)
  }
}
