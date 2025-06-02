import Foundation
import UIKit
import RuneKit

@objc public final class RuneRouterHost: NSObject {
  private static weak var currentWindow: UIWindow?

  @objc public static func bootstrap(window: UIWindow, runtime: RuneRuntime) -> Bool {
    let stackController = RNStackController()
    stackController.installRootSurface(runtime.rootView)
    currentWindow = window
    window.rootViewController = stackController
    window.makeKeyAndVisible()
    RuneRouter.attach(runtime: runtime, stackController: stackController)
    NSLog("[RuneRouterHost] RuneRouter attached to window with RNStackController")
    return true
  }

  static func installTabsHost(_ controller: UIViewController) {
    guard let window = currentWindow else { return }
    window.rootViewController = controller
    window.makeKeyAndVisible()
    NSLog("[RuneRouterHost] RuneRouter attached to window with RNTabsHostController")
  }
}
