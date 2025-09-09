import UIKit

final class RuneScreensNavigationController: UINavigationController, UINavigationControllerDelegate, UIGestureRecognizerDelegate {
  override func viewDidLoad() {
    super.viewDidLoad()
    isNavigationBarHidden = false
    view.backgroundColor = .clear
    navigationBar.prefersLargeTitles = true
    delegate = self
    interactivePopGestureRecognizer?.delegate = self
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

  func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    if gestureRecognizer == interactivePopGestureRecognizer {
      return viewControllers.count > 1
    }
    return true
  }
}
