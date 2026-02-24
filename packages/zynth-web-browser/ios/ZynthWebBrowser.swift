import Foundation
import ZynthKit

@objc(ZynthWebBrowser)
public final class ZynthWebBrowser: NSObject {
  private static var module: WebBrowserModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard module == nil else {
      return
    }

    let instance = WebBrowserModule(runtime: runtime)
    runtime.installModules([instance])
    module = instance
  }

  @objc public static func cleanup() {
    module = nil
  }
}
