import Foundation
import ZynthKit

@objc(ZynthUI)
public final class ZynthUI: NSObject {
  private static var appearanceModule: ZynthAppearanceModule?
  private static var appearanceBridge: ZynthAppearanceBridge?
  private static var uiModule: ZynthUIModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard appearanceModule == nil, appearanceBridge == nil, uiModule == nil else {
      NSLog("[ZynthUI] Module already initialized")
      return
    }

    let appearance = ZynthAppearanceModule(runtime: runtime)
    let appearanceBridge = ZynthAppearanceBridge(module: appearance)
    let uiModule = ZynthUIModule()

    runtime.installModules([appearanceBridge, uiModule])
    appearance.initialize()

    self.appearanceModule = appearance
    self.appearanceBridge = appearanceBridge
    self.uiModule = uiModule
    NSLog("[ZynthUI] Module initialized")
  }

  @objc public static func cleanup() {
    appearanceModule?.invalidate()
    appearanceModule = nil
    appearanceBridge = nil
    uiModule = nil
  }
}
