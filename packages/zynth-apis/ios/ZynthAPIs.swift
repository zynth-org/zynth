import Foundation
import ZynthKit

@objc(ZynthAPIs)
public class ZynthAPIs: NSObject {
    @objc public static func initialize(with runtime: ZynthRuntime) {
        let fontModule = ZynthFontModule()
        let fetchModule = FetchModule { name, payload in
            runtime.emitEvent(withName: name, payload: payload)
        }
        
        // Ensure we can access rootView. ZynthRuntime header should expose it.
        // If rootView is nil (e.g. headless), Dimensions might fail gracefully or return empty.
        var modules: [ZynthModule] = [fontModule, fetchModule]
        
        if let rootView = runtime.rootView {
            let dimensionsModule = ZynthDimensionsModule(runtime: runtime, rootView: rootView)
            modules.append(dimensionsModule)
        } else {
            print("[ZynthAPIs] Warning: Runtime has no rootView; Dimensions module not installed.")
        }

        runtime.installModules(modules)
        print("[ZynthAPIs] Initialized modules: Font, Fetch, Dimensions")
    }
}