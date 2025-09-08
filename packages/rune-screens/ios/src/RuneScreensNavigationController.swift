import UIKit

final class RuneScreensNavigationController: UINavigationController, UINavigationControllerDelegate {
  override func viewDidLoad() {
    super.viewDidLoad()
    isNavigationBarHidden = false
    interactivePopGestureRecognizer?.isEnabled = false
    view.backgroundColor = .clear
    navigationBar.prefersLargeTitles = true
    delegate = self
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
}
