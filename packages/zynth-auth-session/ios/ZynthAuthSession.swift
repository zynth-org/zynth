import Foundation
import ZynthKit

@objc(ZynthAuthSession)
public final class ZynthAuthSession: NSObject {
  private static var module: AuthSessionModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard module == nil else {
      return
    }

    let instance = AuthSessionModule(runtime: runtime)
    runtime.installModules([instance])
    module = instance
  }

  @objc public static func cleanup() {
    module = nil
  }
}
