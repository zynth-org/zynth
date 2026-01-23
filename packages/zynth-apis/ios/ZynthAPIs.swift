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
        
        let dimensionsModule = ZynthDimensionsModule(runtime: runtime, rootView: runtime.rootView)
        modules.append(dimensionsModule)

        runtime.installModules(modules)
        print("[ZynthAPIs] Initialized modules: Font, Fetch, Dimensions")
    }
}