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
    let cornerRadius = estimatedDisplayCornerRadius()
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
      "hasRoundedDisplayCorners": cornerRadius > 0,
      "displayCornerRadius": cornerRadius > 0 ? cornerRadius : NSNull(),
    ]
  }

  private func estimatedDisplayCornerRadius() -> CGFloat {
    if !Thread.isMainThread {
      var value: CGFloat = 0
      DispatchQueue.main.sync {
        value = self.estimatedDisplayCornerRadiusOnMain()
      }
      return value
    }
    return estimatedDisplayCornerRadiusOnMain()
  }

  private func estimatedDisplayCornerRadiusOnMain() -> CGFloat {
    let window = activeWindowOnMain()
    if let layerRadius = window?.layer.cornerRadius, layerRadius > 0 {
      return layerRadius
    }

    let insets = window?.safeAreaInsets ?? .zero
    let bounds = window?.bounds ?? UIScreen.main.bounds
    let shortest = min(bounds.width, bounds.height)
    let hasRoundedSignals =
      insets.bottom > 0 || insets.left > 0 || insets.right > 0 || insets.top > 20

    if hasRoundedSignals {
      return max(30, min(60, shortest * 0.125))
    }
    if UIDevice.current.userInterfaceIdiom == .phone, shortest >= 390 {
      return max(20, min(42, shortest * 0.095))
    }
    return 0
  }

  private func activeWindowOnMain() -> UIWindow? {
    guard #available(iOS 13.0, *) else {
      return nil
    }
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      guard scene.activationState == .foregroundActive || scene.activationState == .foregroundInactive else {
        continue
      }
      if let key = windowScene.windows.first(where: { $0.isKeyWindow }) {
        return key
      }
      if let first = windowScene.windows.first {
        return first
      }
    }
    return nil
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
