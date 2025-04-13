import Foundation
import UIKit
import RuneKit

@objc public final class RuneRouterHost: NSObject {
  @objc public static func bootstrap(window: UIWindow, runtime: RuneRuntime) -> Bool {
    let stackController = RNStackController()
    stackController.installRootSurface(runtime.rootView)
    window.rootViewController = stackController
    window.makeKeyAndVisible()
    RuneRouter.attach(runtime: runtime, stackController: stackController)
    NSLog("[RuneRouterHost] RuneRouter attached to window with RNStackController")
    return true
  }
}
