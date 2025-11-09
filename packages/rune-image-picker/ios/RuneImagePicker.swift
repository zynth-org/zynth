import Foundation
import RuneKit

@objc(RuneImagePicker)
public class RuneImagePicker: NSObject {
    @objc public static func initialize(with runtime: RuneRuntime) {
        let module = ImagePickerModule(runtime: runtime)
        runtime.installModules([module])
        print("[RuneImagePicker] Initialized")
    }
}
