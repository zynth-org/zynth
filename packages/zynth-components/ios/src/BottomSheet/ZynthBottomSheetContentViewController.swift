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
    presenter?.contentHeightDidChange(
      height: measuredContentHeight(),
      bottomSafeAreaInset: max(view.safeAreaInsets.bottom, 0)
    )
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
    let bounds = view.bounds
    contentHost.frame = CGRect(
      x: bounds.origin.x,
      y: bounds.origin.y,
      width: bounds.width,
      height: bounds.height
    )
  }

  private func measuredContentHeight() -> CGFloat {
    contentHost.layoutIfNeeded()
    var maxChildY: CGFloat = 0
    for child in contentHost.subviews where !child.isHidden {
      let deepestBottom = deepestVisibleBottom(in: child) ?? child.frame.maxY
      maxChildY = max(maxChildY, deepestBottom)
    }
    let fittingHeight = contentHost.systemLayoutSizeFitting(
      CGSize(width: view.bounds.width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel
    ).height
    let frameMeasured = max(maxChildY, 0)
    return frameMeasured > 0 ? frameMeasured : max(fittingHeight, 0)
  }

  private func deepestVisibleBottom(in root: UIView) -> CGFloat? {
    if root.isHidden || root.alpha <= 0.001 {
      return nil
    }
    var maxBottom: CGFloat? = nil
    for child in root.subviews where !child.isHidden {
      if let nested = deepestVisibleBottom(in: child) {
        maxBottom = max(maxBottom ?? nested, nested)
      }
    }
    if maxBottom != nil {
      return maxBottom
    }
    let frameInHost = root.convert(root.bounds, to: contentHost)
    return frameInHost.maxY
  }
}
