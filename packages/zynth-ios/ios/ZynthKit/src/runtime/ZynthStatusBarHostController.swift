import UIKit

@objcMembers
public final class ZynthStatusBarHostController: UIViewController {
  private var statusBarObserver: NSObjectProtocol?

  public override func viewDidLoad() {
    super.viewDidLoad()
    statusBarObserver = NotificationCenter.default.addObserver(
      forName: ZynthStatusBarState.didChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.setNeedsStatusBarAppearanceUpdate()
    }
  }

  deinit {
    if let observer = statusBarObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  public override var preferredStatusBarStyle: UIStatusBarStyle {
    ZynthStatusBarState.shared.resolvedStyle
  }

  public override var prefersStatusBarHidden: Bool {
    ZynthStatusBarState.shared.resolvedHidden
  }

  public override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation {
    ZynthStatusBarState.shared.animation
  }
}
