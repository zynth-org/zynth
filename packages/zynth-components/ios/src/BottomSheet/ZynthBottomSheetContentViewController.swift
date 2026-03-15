import UIKit

@available(iOS 16.0, *)
final class ZynthBottomSheetContentViewController: UIViewController {
  private let contentHost: UIView
  weak var presenter: ZynthBottomSheetPresenter?

  init(contentHost: UIView) {
    self.contentHost = contentHost
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    return nil
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    view.insetsLayoutMarginsFromSafeArea = false
    view.directionalLayoutMargins = .zero
    attachContent()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    layoutContentHost()
    presenter?.sheetDidLayout(height: view.frame.height)
  }

  func attachContent() {
    if contentHost.superview !== view {
      contentHost.removeFromSuperview()
      view.addSubview(contentHost)
    }
    layoutContentHost()
    contentHost.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  func detachContent(to host: UIView) {
    if contentHost.superview !== host {
      contentHost.removeFromSuperview()
      host.addSubview(contentHost)
    }
    contentHost.frame = host.bounds
    contentHost.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  private func layoutContentHost() {
    // Expand host into the bottom safe-area strip without mutating
    // controller safe-area insets (which can trigger UIKit recursion).
    let safeBottom = max(view.safeAreaInsets.bottom, 0)
    let bounds = view.bounds
    contentHost.frame = CGRect(
      x: bounds.origin.x,
      y: bounds.origin.y,
      width: bounds.width,
      height: bounds.height + safeBottom
    )
  }
}
