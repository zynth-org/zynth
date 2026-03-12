import Foundation
import ZynthKit

@objc(ZynthFileIntents)
public class ZynthFileIntents: NSObject {
  private static var moduleInstance: FileIntentsModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthFileIntents] Module already initialized")
      return
    }

    let module = FileIntentsModule(runtime: runtime)
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthFileIntents] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
