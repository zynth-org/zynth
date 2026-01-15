import Foundation
import ZynthKit

@objc(ZynthImagePicker)
public class ZynthImagePicker: NSObject {
    @objc public static func initialize(with runtime: ZynthRuntime) {
        let module = ImagePickerModule(runtime: runtime)
        runtime.installModules([module])
        print("[ZynthImagePicker] Initialized")
    }
}
