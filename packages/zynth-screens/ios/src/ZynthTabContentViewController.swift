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
    NSLog("[ZynthTabContent] loadView - title: \(title ?? "nil")")
    view = containerView
    containerView.backgroundColor = .clear
    containerView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    NSLog("[ZynthTabContent] viewDidLoad - title: \(title ?? "nil"), contentView: \(contentView), bounds: \(containerView.bounds)")
    NSLog("[ZynthTabContent] viewDidLoad - contentView BEFORE: hidden: \(contentView.isHidden), alpha: \(contentView.alpha), frame: \(contentView.frame)")
    
    // Add content view to container
    contentView.removeFromSuperview()
    contentView.frame = containerView.bounds
    contentView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // Ensure content view is visible
    contentView.isHidden = false
    contentView.alpha = 1.0
    containerView.addSubview(contentView)
    NSLog("[ZynthTabContent] viewDidLoad - contentView AFTER: hidden: \(contentView.isHidden), alpha: \(contentView.alpha), subviews: \(containerView.subviews.count)")
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    NSLog("[ZynthTabContent] viewDidLayoutSubviews - title: \(title ?? "nil"), bounds: \(containerView.bounds), contentView.frame: \(contentView.frame)")
    // Ensure content view fills the container
    contentView.frame = containerView.bounds
  }
  
  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    NSLog("[ZynthTabContent] viewWillAppear - title: \(title ?? "nil"), contentView hidden: \(contentView.isHidden), alpha: \(contentView.alpha)")
    // Force layout when becoming visible
    view.setNeedsLayout()
    view.layoutIfNeeded()
  }
  
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    NSLog("[ZynthTabContent] viewDidAppear - title: \(title ?? "nil"), frame: \(view.frame), contentView.frame: \(contentView.frame)")
  }
  
  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    NSLog("[ZynthTabContent] viewWillDisappear - title: \(title ?? "nil")")
  }
}
