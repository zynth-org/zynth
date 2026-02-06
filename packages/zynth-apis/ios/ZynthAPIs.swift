import Foundation
import ZynthKit

@objc(ZynthAPIs)
public class ZynthAPIs: NSObject {
    @objc public static func initialize(with runtime: ZynthRuntime) {
        let fontModule = ZynthFontModule()
        
        // Ensure we can access rootView. ZynthRuntime header should expose it.
        // If rootView is nil (e.g. headless), Dimensions might fail gracefully or return empty.
        var modules: [ZynthModule] = [fontModule]
        
        let dimensionsModule = ZynthDimensionsModule(runtime: runtime, rootView: runtime.rootView)
        let appStateModule = ZynthAppStateModule(runtime: runtime)
        let networkModule = ZynthNetworkModule(runtime: runtime)
        let deviceModule = ZynthDeviceModule()
        modules.append(dimensionsModule)
        modules.append(appStateModule)
        modules.append(networkModule)
        modules.append(deviceModule)

        // Initialize Safe Area and include its bridge in the module registry
        let safeAreaModule = ZynthSafeAreaModule(runtime: runtime)
        let safeAreaBridge = safeAreaModule.makeBridge()
        safeAreaModule.start()
        modules.append(safeAreaBridge)

        runtime.installModules(modules)
        print("[ZynthAPIs] Initialized modules: Font, Dimensions, AppState, Network, Device, SafeArea")
    }
}
