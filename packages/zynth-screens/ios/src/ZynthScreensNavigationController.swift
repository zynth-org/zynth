import UIKit

final class ZynthScreensNavigationController: UINavigationController, UINavigationControllerDelegate, UIGestureRecognizerDelegate {
  weak var screenContainer: ZynthScreenContainerView?
  private var previousViewControllers: [UIViewController] = []
  private var isPerformingProgrammaticUpdate = false
  private let transitionWillBeginName = Notification.Name("ZynthScreenTransitionWillBegin")
  private let transitionDidEndName = Notification.Name("ZynthScreenTransitionDidEnd")

  override func viewDidLoad() {
    super.viewDidLoad()
    isNavigationBarHidden = false
    view.backgroundColor = .clear
    navigationBar.prefersLargeTitles = true
    delegate = self
    interactivePopGestureRecognizer?.delegate = self
    previousViewControllers = viewControllers
    refreshInteractiveGestureState()
  }

  func performProgrammaticUpdate(_ block: () -> Void) {
    isPerformingProgrammaticUpdate = true
    block()
    previousViewControllers = viewControllers
    isPerformingProgrammaticUpdate = false
    refreshInteractiveGestureState()
  }

  func updateNavigationBarHiddenState(animated: Bool) {
    guard let top = topViewController as? ZynthScreenViewController else { return }
    setNavigationBarHidden(!top.screenView.headerOptions.isVisible, animated: animated)
  }

  func navigationController(
    _ navigationController: UINavigationController,
    willShow viewController: UIViewController,
    animated: Bool
  ) {
    guard let screenVC = viewController as? ZynthScreenViewController else { return }
    setNavigationBarHidden(!screenVC.screenView.headerOptions.isVisible, animated: animated)
  }

  func navigationController(
    _ navigationController: UINavigationController,
    didShow viewController: UIViewController,
    animated: Bool
  ) {
    guard !isPerformingProgrammaticUpdate else {
      previousViewControllers = navigationController.viewControllers
      return
    }

    let poppedControllers = previousViewControllers.compactMap { $0 as? ZynthScreenViewController }.filter { controller in
      return !navigationController.viewControllers.contains(where: { $0 === controller })
    }

    if let popped = poppedControllers.first {
      screenContainer?.handleNativePop(for: popped)
      NotificationCenter.default.post(name: transitionDidEndName, object: nil)
    }

    previousViewControllers = navigationController.viewControllers
    refreshInteractiveGestureState()
  }

  func navigationController(
    _ navigationController: UINavigationController,
    animationControllerFor operation: UINavigationController.Operation,
    from fromVC: UIViewController,
    to toVC: UIViewController
  ) -> UIViewControllerAnimatedTransitioning? {
    if operation == .pop {
      NotificationCenter.default.post(name: transitionWillBeginName, object: nil)
    }

    guard
      let fromScreen = fromVC as? ZynthScreenViewController,
      let toScreen = toVC as? ZynthScreenViewController
    else {
      return nil
    }

    let animationType: ZynthScreenAnimation
    switch operation {
    case .push:
      animationType = toScreen.screenView.animationType
    case .pop:
      animationType = fromScreen.screenView.animationType
    default:
      return nil
    }

    switch animationType {
    case .modal:
      return ZynthScreenModalTransitionAnimator(operation: operation)
    case .sheetBlur:
      return ZynthScreenBlurTransitionAnimator(operation: operation)
    case .zoom:
      if usesNativeZoomTransition(for: operation, from: fromScreen, to: toScreen) {
        return nil
      }
      return ZynthScreenZoomTransitionAnimator(operation: operation)
    default:
      return nil
    }
  }

  func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if gestureRecognizer == interactivePopGestureRecognizer {
      guard viewControllers.count > 1 else { return false }
      guard let top = topViewController as? ZynthScreenViewController else { return true }
      if !top.screenView.gestureEnabled {
        return false
      }
      if top.screenView.animationType == .zoom && !top.usesNativeZoomTransition {
        return false
      }
      return true
    }
    return true
  }

  func refreshInteractiveGestureState() {
    guard let gesture = interactivePopGestureRecognizer else { return }
    guard
      viewControllers.count > 1,
      let top = topViewController as? ZynthScreenViewController
    else {
      gesture.isEnabled = false
      return
    }

    if top.screenView.animationType == .zoom && !top.usesNativeZoomTransition {
      gesture.isEnabled = false
      return
    }

    gesture.isEnabled = top.screenView.gestureEnabled
  }

  private func usesNativeZoomTransition(
    for operation: UINavigationController.Operation,
    from fromVC: ZynthScreenViewController,
    to toVC: ZynthScreenViewController
  ) -> Bool {
    if #available(iOS 18.0, *) {
      switch operation {
      case .push:
        return toVC.usesNativeZoomTransition
      case .pop:
        return fromVC.usesNativeZoomTransition
      default:
        return false
      }
    }
    return false
  }
}
