import Foundation
import ZynthKit

@objc(ZynthMarkdown)
public class ZynthMarkdown: NSObject {
  private static var moduleInstance: ZynthMarkdownModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthMarkdown] Module already initialized")
      return
    }

    let module = ZynthMarkdownModule()
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthMarkdown] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
