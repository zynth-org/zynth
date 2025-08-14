import Foundation
import RuneKit

@objc public class RuneAPIs: NSObject {
    @objc public static func initialize(with runtime: RuneRuntime) {
        let fontModule = RuneFontModule()
        runtime.installModules([fontModule])
        print("[RuneAPIs] Initialized modules")
    }
}
