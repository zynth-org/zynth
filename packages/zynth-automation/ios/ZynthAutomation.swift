import Foundation
import ZynthKit

@objc(ZynthAutomation)
public class ZynthAutomation: NSObject {
  private static var moduleInstance: ZynthAutomationModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      return
    }

    let module = ZynthAutomationModule(runtime: runtime)
    runtime.installModules([module])
    moduleInstance = module
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
