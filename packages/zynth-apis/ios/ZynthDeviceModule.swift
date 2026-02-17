import Foundation
import UIKit
import ZynthKit
import Darwin

@objc(ZynthDeviceModule)
final class ZynthDeviceModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Device"

  var exportedMethods: [String] {
    return ["getInfo", "current"]
  }

  var constantsToExport: [String: Any]? {
    deviceInfo()
  }

  func call(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getInfo", "current":
      return ["result": deviceInfo()]
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  func callSync(method: String, args: ZynthArgs) throws -> Any? {
    switch method {
    case "getInfo", "current":
      return deviceInfo()
    default:
      throw ZynthModuleError.methodNotExported(module: name, method: method)
    }
  }

  private func deviceInfo() -> [String: Any] {
    let device = UIDevice.current
    return [
      "platform": "ios",
      "model": device.model,
      "modelId": machineIdentifier(),
      "brand": "Apple",
      "manufacturer": "Apple",
      "deviceName": device.name,
      "osName": device.systemName,
      "osVersion": device.systemVersion,
      "osBuildId": ProcessInfo.processInfo.operatingSystemVersionString,
      "serialNumber": NSNull(),
      "uniqueId": device.identifierForVendor?.uuidString as Any? ?? NSNull(),
      "sdkInt": NSNull(),
      "isEmulator": isRunningOnSimulator(),
    ]
  }

  private func isRunningOnSimulator() -> Bool {
    #if targetEnvironment(simulator)
      return true
    #else
      return false
    #endif
  }

  private func machineIdentifier() -> String {
    var info = utsname()
    uname(&info)
    let mirror = Mirror(reflecting: info.machine)
    return mirror.children.reduce(into: "") { identifier, value in
      guard let element = value.value as? Int8, element != 0 else { return }
      identifier.append(Character(UnicodeScalar(UInt8(element))))
    }
  }
}
