import UIKit

final class ZynthTabContentViewController: UIViewController {
  private let contentView: UIView
  private let containerView = UIView()

  init(contentView: UIView) {
    self.contentView = contentView
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func loadView() {
    view = containerView
    containerView.backgroundColor = .clear
    containerView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  override func viewDidLoad() {
    super.viewDidLoad()

    // Add content view to container
    contentView.removeFromSuperview()
    contentView.frame = containerView.bounds
    contentView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // Ensure content view is visible
    contentView.isHidden = false
    contentView.alpha = 1.0
    containerView.addSubview(contentView)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    // Ensure content view fills the container
    contentView.frame = containerView.bounds
  }
  
  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    // Force layout when becoming visible
    view.setNeedsLayout()
    view.layoutIfNeeded()
  }
  
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
  }
  
  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
  }
}
