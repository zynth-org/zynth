import Foundation
import ZynthKit

@objc(SkiaModule)
public final class SkiaModule: NSObject {
  private static var isInstalled = false

  @objc public static func initialize(with runtime: ZynthRuntime) {
    if isInstalled {
      print("[ZynthSkia] Skia module already initialized")
      return
    }

    runtime.installModules([ZynthSkiaModule(runtime: runtime)])
    isInstalled = true
    print("[ZynthSkia] Skia module initialized")
  }
}
