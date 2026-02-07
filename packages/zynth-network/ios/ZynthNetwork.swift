import Foundation
import ZynthKit

@objc(ZynthNetwork)
public class ZynthNetwork: NSObject {
  private static var moduleInstance: NetworkModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      NSLog("[ZynthNetwork] Module already initialized")
      return
    }

    let module = NetworkModule()
    runtime.installModules([module])
    moduleInstance = module
    NSLog("[ZynthNetwork] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
