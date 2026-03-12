import Foundation
import ZynthKit

@objc(ZynthMediaLibrary)
public class ZynthMediaLibrary: NSObject {
  private static var moduleInstance: MediaLibraryModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthMediaLibrary] Module already initialized")
      return
    }

    let module = MediaLibraryModule(runtime: runtime)
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthMediaLibrary] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
