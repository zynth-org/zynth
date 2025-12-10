import UIKit

final class RuneModalContentViewController: UIViewController {
  let contentHost: UIView
  let overlayView = UIControl()
  private var options: RuneModalOptions
  var onOverlayTap: (() -> Void)?

  var resolvedOverlayOpacity: CGFloat {
    return options.transparent ? 0 : options.overlayOpacity
  }

  init(contentHost: UIView, options: RuneModalOptions) {
    self.contentHost = contentHost
    self.options = options
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear

    overlayView.translatesAutoresizingMaskIntoConstraints = false
    overlayView.backgroundColor = options.overlayColor
    overlayView.alpha = resolvedOverlayOpacity
    overlayView.addTarget(self, action: #selector(handleOverlayTap), for: .touchUpInside)

    contentHost.removeFromSuperview()
    contentHost.translatesAutoresizingMaskIntoConstraints = false
    contentHost.backgroundColor = .clear

    view.addSubview(overlayView)
    view.addSubview(contentHost)

    NSLayoutConstraint.activate([
      overlayView.topAnchor.constraint(equalTo: view.topAnchor),
      overlayView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      overlayView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      overlayView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      contentHost.topAnchor.constraint(equalTo: view.topAnchor),
      contentHost.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      contentHost.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      contentHost.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  func applyOptions(_ newOptions: RuneModalOptions) {
    options = newOptions
    overlayView.backgroundColor = newOptions.overlayColor
    overlayView.alpha = resolvedOverlayOpacity
  }

  @objc private func handleOverlayTap() {
    onOverlayTap?()
  }
}
