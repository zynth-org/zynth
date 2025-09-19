import UIKit

final class RuneScreensNavigationController: UINavigationController, UINavigationControllerDelegate, UIGestureRecognizerDelegate {
  weak var screenContainer: RuneScreenContainerView?
  private var previousViewControllers: [UIViewController] = []
  private var isPerformingProgrammaticUpdate = false

  override func viewDidLoad() {
    super.viewDidLoad()
    isNavigationBarHidden = false
    view.backgroundColor = .clear
    navigationBar.prefersLargeTitles = true
    delegate = self
    interactivePopGestureRecognizer?.delegate = self
    previousViewControllers = viewControllers
  }

  func performProgrammaticUpdate(_ block: () -> Void) {
    isPerformingProgrammaticUpdate = true
    block()
    previousViewControllers = viewControllers
    isPerformingProgrammaticUpdate = false
  }

  func updateNavigationBarHiddenState(animated: Bool) {
    guard let top = topViewController as? RuneScreenViewController else { return }
    setNavigationBarHidden(!top.screenView.headerOptions.isVisible, animated: animated)
  }

  func navigationController(
    _ navigationController: UINavigationController,
    willShow viewController: UIViewController,
    animated: Bool
  ) {
    guard let screenVC = viewController as? RuneScreenViewController else { return }
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

    let poppedControllers = previousViewControllers.compactMap { $0 as? RuneScreenViewController }.filter { controller in
      return !navigationController.viewControllers.contains(where: { $0 === controller })
    }

    if let popped = poppedControllers.first {
      screenContainer?.handleNativePop(for: popped)
    }

    previousViewControllers = navigationController.viewControllers
  }

  func navigationController(
    _ navigationController: UINavigationController,
    animationControllerFor operation: UINavigationController.Operation,
    from fromVC: UIViewController,
    to toVC: UIViewController
  ) -> UIViewControllerAnimatedTransitioning? {
    guard
      let fromScreen = fromVC as? RuneScreenViewController,
      let toScreen = toVC as? RuneScreenViewController
    else {
      return nil
    }

    let animationType: RuneScreenAnimation
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
      return RuneScreenModalTransitionAnimator(operation: operation)
    default:
      return nil
    }
  }

  func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if gestureRecognizer == interactivePopGestureRecognizer {
      return viewControllers.count > 1
    }
    return true
  }
}
