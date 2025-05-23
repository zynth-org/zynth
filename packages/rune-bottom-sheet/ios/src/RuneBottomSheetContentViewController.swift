import UIKit

@available(iOS 16.0, *)
final class RuneBottomSheetContentViewController: UIViewController {
  let contentHost: UIView
  weak var presenter: RuneBottomSheetPresenter?

  init(contentHost: UIView) {
    self.contentHost = contentHost
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    contentHost.removeFromSuperview()
    contentHost.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(contentHost)
    NSLayoutConstraint.activate([
      contentHost.topAnchor.constraint(equalTo: view.topAnchor),
      contentHost.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      contentHost.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      contentHost.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    presenter?.sheetDidLayout(height: view.frame.height)
  }
}
