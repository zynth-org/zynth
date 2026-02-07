import Foundation
import ZynthKit

@objc(ZynthDocumentPicker)
public class ZynthDocumentPicker: NSObject {
  private static var moduleInstance: DocumentPickerModule?

  @objc public static func initialize(with runtime: ZynthRuntime) {
    guard moduleInstance == nil else {
      print("[ZynthDocumentPicker] Module already initialized")
      return
    }

    let module = DocumentPickerModule(runtime: runtime)
    runtime.installModules([module])
    moduleInstance = module
    print("[ZynthDocumentPicker] Module initialized")
  }

  @objc public static func cleanup() {
    moduleInstance = nil
  }
}
