import Foundation
import ZynthKit

@objc(ZynthSensors)
public class ZynthSensors: NSObject {
  private static var moduleInstance: SensorsModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      NSLog("[ZynthSensors] Module already initialized")
      return
    }

    let module = SensorsModule(runtime: runtime)
    runtime.installModules([module])
    moduleInstance = module
    NSLog("[ZynthSensors] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance?.invalidate()
    moduleInstance = nil
  }
}
