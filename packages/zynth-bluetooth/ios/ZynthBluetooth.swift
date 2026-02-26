import Foundation
import ZynthKit

@objc(ZynthBluetooth)
public final class ZynthBluetooth: NSObject {
  private static var module: BluetoothModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard module == nil else {
      return
    }

    let instance = BluetoothModule(runtime: runtime)
    runtime.installModules([instance])
    module = instance
  }

  @objc public static func cleanup() {
    module = nil
  }
}
