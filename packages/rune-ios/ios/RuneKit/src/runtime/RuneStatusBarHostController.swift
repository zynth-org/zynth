import UIKit

@objcMembers
public final class RuneStatusBarHostController: UIViewController {
  private var statusBarObserver: NSObjectProtocol?

  public override func viewDidLoad() {
    super.viewDidLoad()
    statusBarObserver = NotificationCenter.default.addObserver(
      forName: RuneStatusBarState.didChangeNotification,
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
    RuneStatusBarState.shared.resolvedStyle
  }

  public override var prefersStatusBarHidden: Bool {
    RuneStatusBarState.shared.resolvedHidden
  }

  public override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation {
    RuneStatusBarState.shared.animation
  }
}
