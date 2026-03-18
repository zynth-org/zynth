import ZynthKit

@objc(ZynthUIBootstrap)
public final class ZynthUIBootstrap: NSObject {
  @objc public static func initialize(with runtime: ZynthRuntime) {
    ZynthUI.initialize(with: runtime)
  }

  @objc public static func cleanup() {
    ZynthUI.cleanup()
  }
}
