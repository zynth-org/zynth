import UIKit

@objc(ZynthViewController)
open class ZynthViewController: UIViewController {
  
  public override init(nibName nibNameOrNil: String?, bundle nibBundleOrNil: Bundle?) {
    super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
    observeStatusBarState()
  }
  
  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    observeStatusBarState()
  }
  
  deinit {
    NotificationCenter.default.removeObserver(self)
  }
  
  private func observeStatusBarState() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleStatusBarChange),
      name: ZynthStatusBarState.didChangeNotification,
      object: nil
    )
  }
  
  @objc private func handleStatusBarChange() {
    UIView.animate(withDuration: 0.25) {
        self.setNeedsStatusBarAppearanceUpdate()
    }
  }
  
  open override var preferredStatusBarStyle: UIStatusBarStyle {
    return ZynthStatusBarState.shared.resolvedStyle
  }
  
  open override var prefersStatusBarHidden: Bool {
    return ZynthStatusBarState.shared.resolvedHidden
  }
  
  open override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation {
    return ZynthStatusBarState.shared.animation
  }
}
