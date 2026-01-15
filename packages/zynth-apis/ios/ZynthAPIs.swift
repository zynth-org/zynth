import Foundation
import ZynthKit

@objc(ZynthAPIs)
public class ZynthAPIs: NSObject {
    @objc public static func initialize(with runtime: ZynthRuntime) {
        let fontModule = ZynthFontModule()
        runtime.installModules([fontModule])
        print("[ZynthAPIs] Initialized modules")
    }
}
