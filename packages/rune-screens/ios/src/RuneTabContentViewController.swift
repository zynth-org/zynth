import UIKit

final class RuneTabContentViewController: UIViewController {
  private let contentView: UIView

  init(contentView: UIView) {
    self.contentView = contentView
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func loadView() {
    view = contentView
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    contentView.frame = view.bounds
  }
}
