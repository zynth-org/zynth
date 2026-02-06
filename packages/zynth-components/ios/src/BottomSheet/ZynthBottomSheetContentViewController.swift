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
    attachContent()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    contentHost.frame = view.bounds
    presenter?.sheetDidLayout(height: view.frame.height)
  }

  func attachContent() {
    if contentHost.superview !== view {
      contentHost.removeFromSuperview()
      view.addSubview(contentHost)
    }
    contentHost.frame = view.bounds
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
}
