import UIKit

final class RuneDeviceModule: RuneModule, RuneSyncModule {
  let name: String = "Device"

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "info":
      let device = UIDevice.current
      let payload: [String: Any] = [
        "result": [
          "name": device.name ?? "",
          "model": device.model ?? "",
          "systemName": device.systemName ?? "",
          "systemVersion": device.systemVersion ?? "",
        ]
      ]
      return payload
    default:
      return [
        "error": "unknown_method",
        "module": name,
        "method": method,
      ]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "constants":
      return [
        "platform": "ios",
        "runtime": "hermes",
        "timestamp": Date().timeIntervalSince1970,
      ]
    default:
      throw RuneModuleError.syncNotSupported(module: name, method: method)
    }
  }
}
