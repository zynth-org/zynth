import UIKit

@objcMembers
public final class ZynthScreenContainerView: UIView, ZynthScreenContainer {
  private var orderedScreens: [ZynthScreenView] = []
  private var controllerMap: [ObjectIdentifier: ZynthScreenViewController] = [:]
  private var pendingNavigationUpdate = false

  private weak var hostingController: UIViewController?
  private var navigationController: ZynthScreensNavigationController?

  public override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = true
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    clipsToBounds = true
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    navigationController?.view.frame = bounds
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      attachNavigationControllerIfNeeded()
      scheduleNavigationUpdate()
    } else {
      detachNavigationController()
    }
  }

  public func insertScreen(_ screen: ZynthScreenView, at index: Int) {
    let clampedIndex = max(0, min(index, orderedScreens.count))
    orderedScreens.removeAll { $0 === screen }
    orderedScreens.insert(screen, at: clampedIndex)
    screen.container = self
    scheduleNavigationUpdate()
  }

  public func removeScreen(_ screen: ZynthScreenView) {
    orderedScreens.removeAll { $0 === screen }
    controllerMap.removeValue(forKey: ObjectIdentifier(screen))
    screen.container = nil
    scheduleNavigationUpdate()
  }

  func screenDidAttach(_ screen: ZynthScreenView) {
    if !orderedScreens.contains(where: { $0 === screen }) {
      orderedScreens.append(screen)
    }
    scheduleNavigationUpdate()
  }

  func screenDidChangeActiveState(_ screen: ZynthScreenView) {
    scheduleNavigationUpdate()
  }

  private func attachNavigationControllerIfNeeded() {
    guard navigationController == nil else { return }
    guard let parentVC = findParentViewController() else { return }

    let navController = ZynthScreensNavigationController()
    parentVC.addChild(navController)
    navController.view.frame = bounds
    navController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(navController.view)
    navController.didMove(toParent: parentVC)
    navController.screenContainer = self

    navigationController = navController
    hostingController = parentVC
  }

  private func detachNavigationController() {
    guard let navController = navigationController else { return }
    navController.willMove(toParent: nil)
    navController.view.removeFromSuperview()
    navController.removeFromParent()
    navigationController = nil
    hostingController = nil
  }

  func screenHeaderOptionsDidChange(_ screen: ZynthScreenView) {
    let identifier = ObjectIdentifier(screen)
    if let controller = controllerMap[identifier] {
      controller.applyHeaderOptions()
      navigationController?.updateNavigationBarHiddenState(animated: false)
    }
  }

  func handleNativePop(for controller: ZynthScreenViewController) {
    controller.screenView.notifyNativeBackRequested()
  }

  func refreshInteractiveGestureState() {
    navigationController?.refreshInteractiveGestureState()
  }

  func screenAnimationDidChange(_ screen: ZynthScreenView) {
    let identifier = ObjectIdentifier(screen)
    guard let controller = controllerMap[identifier] else { return }
    controller.updatePreferredTransitionConfiguration()
    navigationController?.refreshInteractiveGestureState()
  }

  private func controller(for screen: ZynthScreenView, createIfMissing: Bool = true) -> ZynthScreenViewController? {
    let identifier = ObjectIdentifier(screen)
    if let existing = controllerMap[identifier] {
      return existing
    }
    guard createIfMissing else { return nil }
    let controller = ZynthScreenViewController(screenView: screen)
    controller.applyHeaderOptions()
    controller.updatePreferredTransitionConfiguration()
    controllerMap[identifier] = controller
    return controller
  }

  private func scheduleNavigationUpdate() {
    guard !pendingNavigationUpdate else { return }
    pendingNavigationUpdate = true
    DispatchQueue.main.async { [weak self] in
      self?.pendingNavigationUpdate = false
      self?.applyNavigationChanges()
    }
  }

  private func applyNavigationChanges() {
    attachNavigationControllerIfNeeded()
    guard let navController = navigationController else { return }

    let activeScreens = orderedScreens.filter { $0.isScreenActive }
    let desiredControllers = activeScreens.compactMap { controller(for: $0) }
    let currentControllers = navController.viewControllers.compactMap { $0 as? ZynthScreenViewController }

    let finalizeUpdate: (Bool) -> Void = { animated in
      navController.updateNavigationBarHiddenState(animated: animated)
      desiredControllers.last?.applyHeaderOptions()
      navController.refreshInteractiveGestureState()
    }

    if currentControllers == desiredControllers {
      finalizeUpdate(false)
      return
    }

    if currentControllers.isEmpty {
      navController.performProgrammaticUpdate {
        navController.setViewControllers(desiredControllers, animated: false)
      }
      finalizeUpdate(false)
      return
    }

    if desiredControllers.count == currentControllers.count + 1,
       Array(desiredControllers.dropLast()) == currentControllers,
       let newController = desiredControllers.last {
      navController.performProgrammaticUpdate {
        navController.pushViewController(newController, animated: true)
      }
      finalizeUpdate(true)
      return
    }

    if desiredControllers.count < currentControllers.count,
       Array(currentControllers.prefix(desiredControllers.count)) == desiredControllers {
      if let target = desiredControllers.last {
        navController.performProgrammaticUpdate {
          navController.popToViewController(target, animated: true)
        }
      } else {
        navController.performProgrammaticUpdate {
          navController.setViewControllers([], animated: false)
        }
      }
      finalizeUpdate(true)
      return
    }

    navController.performProgrammaticUpdate {
      navController.setViewControllers(desiredControllers, animated: false)
    }
    finalizeUpdate(false)
  }

  private func findParentViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let vc = next as? UIViewController {
        return vc
      }
      responder = next
    }
    return nil
  }
}

private func == (lhs: [ZynthScreenViewController], rhs: [ZynthScreenViewController]) -> Bool {
  guard lhs.count == rhs.count else { return false }
  for (index, controller) in lhs.enumerated() {
    if controller !== rhs[index] {
      return false
    }
  }
  return true
}
