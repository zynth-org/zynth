import Foundation
import RuneKit

@objc(RuneRouter)
public final class RuneRouter: NSObject {
  private static var module: RuneRouterModule?

  @objc
  public static func attach(runtime: RuneRuntime, stackController: RNStackController) {
    stackController.runtime = runtime
    if let existing = module {
      existing.attach(stackController: stackController)
      return
    }
    let routerModule = RuneRouterModule(runtime: runtime, stackController: stackController)
    runtime.installModules([routerModule])
    module = routerModule
  }
}
