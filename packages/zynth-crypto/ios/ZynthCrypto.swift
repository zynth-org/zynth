import Foundation
import ZynthKit

@objc(ZynthCrypto)
public final class ZynthCrypto: NSObject {
  private static var module: ZynthCryptoModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard module == nil else {
      return
    }

    let instance = ZynthCryptoModule()
    runtime.installModules([instance])
    module = instance
  }

  @objc public static func cleanup() {
    module = nil
  }
}
