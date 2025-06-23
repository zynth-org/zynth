import UIKit

@available(iOS 16.0, *)
protocol RNBottomSheetPresenterDelegate: AnyObject {
  func bottomSheetDidDismiss()
  func bottomSheetDidChangeSnap(index: Int, progress: CGFloat)
}

@available(iOS 16.0, *)
final class RNBottomSheetPresenter: NSObject, UISheetPresentationControllerDelegate, UIAdaptivePresentationControllerDelegate {
  weak var delegate: RNBottomSheetPresenterDelegate?
  private let contentHost: UIView
  private var options = RNBottomSheetOptions()
  private var detentInfo: [SnapDetent] = []
  private var contentController: RNBottomSheetContentViewController?
  private weak var systemDimmingView: UIView?
  private lazy var overlayTapGesture: UITapGestureRecognizer = {
    let gesture = UITapGestureRecognizer(target: self, action: #selector(handleOverlayTap))
    gesture.cancelsTouchesInView = false
    return gesture
  }()
  private var pendingIndex: Int = 0
  private var currentReportedIndex: Int = 0
  private var lastProgress: CGFloat = 0
  private var isSheetOpen = false

  // We need a parent controller to present FROM
  private weak var parentController: UIViewController?

  init(contentHost: UIView, parentController: UIViewController) {
    self.contentHost = contentHost
    self.parentController = parentController
    super.init()
  }

  func updateOptions(_ newOptions: RNBottomSheetOptions) {
    options = newOptions
    rebuildDetents()
    applyBackgroundInteraction(to: contentController?.sheetPresentationController)
    updateSystemDimmingViewState()
  }

  func setOpenState(_ open: Bool, preferredIndex: Int) {
    if open {
      present(index: preferredIndex)
    } else {
      dismiss()
    }
  }

  func present(index: Int? = nil) {
    DispatchQueue.main.async { [weak self] in
      self?.presentInternal(index: index)
    }
  }

  func snapTo(index: Int) {
    let normalized = normalizedIndex(index)
    pendingIndex = normalized

    guard isSheetOpen else { return }
    guard let sheet = contentController?.sheetPresentationController else { return }
    guard let identifier = detentIdentifier(for: normalized) else { return }
    sheet.animateChanges {
      sheet.selectedDetentIdentifier = identifier
    }
  }

  func dismiss() {
    guard isSheetOpen, let controller = contentController else { return }
    controller.dismiss(animated: true) { [weak self] in
      self?.completeDismiss()
    }
  }

  private func presentInternal(index: Int?) {
    let normalized = normalizedIndex(index ?? options.initialSnapIndex)
    pendingIndex = normalized

    if isSheetOpen {
      snapTo(index: normalized)
      return
    }

    guard let controller = parentController else { return }

    let sheet = RNBottomSheetContentViewController(contentHost: contentHost)
    sheet.presenter = self
    sheet.modalPresentationStyle = .pageSheet
    sheet.presentationController?.delegate = self
    sheet.sheetPresentationController?.delegate = self
    sheet.sheetPresentationController?.prefersGrabberVisible = true
    applyDetents(to: sheet.sheetPresentationController)
    applyBackgroundInteraction(to: sheet.sheetPresentationController)

    if let identifier = detentIdentifier(for: normalized) {
      sheet.sheetPresentationController?.selectedDetentIdentifier = identifier
    }

    contentController = sheet
    isSheetOpen = true
    currentReportedIndex = normalized
    lastProgress = 0

    controller.present(sheet, animated: true) { 
      // Presented
    }
  }

  private func rebuildDetents() {
    let screenHeight = UIScreen.main.bounds.height
    var heights = options.snapPoints.map { $0.resolveHeight(maxHeight: screenHeight) }
    heights = heights.map { min(max($0, 0), screenHeight) }
    heights = heights.filter { $0 > 0 }
    heights.sort()
    var unique: [CGFloat] = []
    for height in heights where unique.last != height {
      unique.append(height)
    }
    if unique.isEmpty {
      unique = [screenHeight]
    }

    detentInfo = unique.enumerated().map { index, height in
      let identifier = UISheetPresentationController.Detent.Identifier("rune-bottom-sheet-\(index)")
      let detent = UISheetPresentationController.Detent.custom(identifier: identifier) { _ in
        height
      }
      return SnapDetent(identifier: identifier, detent: detent, height: height)
    }

    pendingIndex = normalizedIndex(pendingIndex)
    currentReportedIndex = normalizedIndex(currentReportedIndex)
    if isSheetOpen {
      applyDetents(to: contentController?.sheetPresentationController)
    }
  }

  private func applyDetents(to sheet: UISheetPresentationController?) {
    guard let sheet = sheet, !detentInfo.isEmpty else { return }
    sheet.detents = detentInfo.map { $0.detent }
    if let identifier = detentIdentifier(for: pendingIndex) {
      sheet.selectedDetentIdentifier = identifier
    }
    applyBackgroundInteraction(to: sheet)
  }

  private func applyBackgroundInteraction(to sheet: UISheetPresentationController?) {
    guard let sheet = sheet else { return }
    if options.allowBackgroundInteraction, let identifier = detentIdentifier(for: detentInfo.count - 1) {
      sheet.largestUndimmedDetentIdentifier = identifier
    } else {
      sheet.largestUndimmedDetentIdentifier = nil
    }
  }

  private func normalizedIndex(_ index: Int) -> Int {
    guard !detentInfo.isEmpty else { return 0 }
    return min(max(index, 0), detentInfo.count - 1)
  }

  private func detentIdentifier(for index: Int) -> UISheetPresentationController.Detent.Identifier? {
    guard !detentInfo.isEmpty else { return nil }
    let clamped = min(max(index, 0), detentInfo.count - 1)
    return detentInfo[clamped].identifier
  }

  func sheetDidLayout(height: CGFloat) {
    guard isSheetOpen, let maxHeight = detentInfo.last?.height, maxHeight > 0 else { return }

    let visible = min(max(height, 0), maxHeight)
    let progress = (maxHeight == 0) ? 0 : (visible / maxHeight)
    let previousProgress = lastProgress
    lastProgress = progress
    updateSystemDimmingViewState()

    let nearest = nearestIndex(for: visible)
    if nearest != currentReportedIndex || abs(progress - previousProgress) > 0.001 {
      currentReportedIndex = nearest
      delegate?.bottomSheetDidChangeSnap(index: nearest, progress: progress)
    }
  }

  private func nearestIndex(for height: CGFloat) -> Int {
    guard !detentInfo.isEmpty else { return 0 }
    var nearest = 0
    var bestDiff = CGFloat.greatestFiniteMagnitude
    for (index, detent) in detentInfo.enumerated() {
      let diff = abs(detent.height - height)
      if diff < bestDiff {
        bestDiff = diff
        nearest = index
      }
    }
    return nearest
  }

  @objc private func handleOverlayTap() {
    guard options.dismissOnOverlayPress && options.allowDismissOnInteraction && !options.allowBackgroundInteraction
    else { return }
    dismiss()
  }

  private func updateSystemDimmingViewState() {
    guard let container = contentController?.presentationController?.containerView else { return }
    guard let dimmingView = resolveSystemDimmingView(in: container) else { return }

    let disableCompletely = options.allowBackgroundInteraction || !options.showOverlay
    if disableCompletely {
      dimmingView.layer.removeAllAnimations()
      dimmingView.isHidden = true
      dimmingView.alpha = 0
      dimmingView.isUserInteractionEnabled = false
      overlayTapGesture.isEnabled = false
      return
    }

    dimmingView.layer.removeAllAnimations()
    dimmingView.backgroundColor = options.overlayColor
    dimmingView.alpha = options.overlayOpacity * lastProgress
    dimmingView.isHidden = lastProgress <= 0

    let canReceiveTouches =
      options.dismissOnOverlayPress &&
      options.allowDismissOnInteraction &&
      !options.allowBackgroundInteraction
    dimmingView.isUserInteractionEnabled = canReceiveTouches
    overlayTapGesture.isEnabled = canReceiveTouches
  }

  private func resolveSystemDimmingView(in container: UIView) -> UIView? {
    if let current = systemDimmingView, current.superview === container {
      return current
    }
    let sheetView = contentController?.view
    let candidates = container.subviews.filter { subview in
      subview !== sheetView
    }
    guard !candidates.isEmpty else { return nil }
    let resolved = candidates.first(where: { view in
      let name = NSStringFromClass(type(of: view)).lowercased()
      return name.contains("dimming") || name.contains("backdrop")
    }) ?? candidates.first
    systemDimmingView = resolved
    if overlayTapGesture.view !== resolved {
      overlayTapGesture.view?.removeGestureRecognizer(overlayTapGesture)
      resolved?.addGestureRecognizer(overlayTapGesture)
    }
    return resolved
  }

  private func detachSystemDimmingView() {
    overlayTapGesture.isEnabled = false
    overlayTapGesture.view?.removeGestureRecognizer(overlayTapGesture)
    systemDimmingView = nil
  }

  private func completeDismiss() {
    guard isSheetOpen else { return }
    isSheetOpen = false
    detachSystemDimmingView()
    contentController = nil
    pendingIndex = 0
    currentReportedIndex = 0
    lastProgress = 0
    delegate?.bottomSheetDidDismiss()
  }

  func presentationControllerWillBeginPresentation(_ presentationController: UIPresentationController) {
    updateSystemDimmingViewState()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    completeDismiss()
  }

  func presentationControllerShouldDismiss(_ presentationController: UIPresentationController) -> Bool {
    return options.allowDismissOnInteraction
  }
}

@available(iOS 16.0, *)
final class RNBottomSheetContentViewController: UIViewController {
  let contentHost: UIView
  weak var presenter: RNBottomSheetPresenter?

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

struct RNBottomSheetOptions {
  var snapPoints: [BottomSheetSnapPoint] = RNBottomSheetOptions.defaultSnapPoints
  var overlayColor: UIColor = .black
  var overlayOpacity: CGFloat = 0.58
  var showOverlay: Bool = true
  var dismissOnOverlayPress: Bool = true
  var initialSnapIndex: Int = 0
  var allowDismissOnInteraction: Bool = true
  var allowBackgroundInteraction: Bool = false

  static let defaultSnapPoints: [BottomSheetSnapPoint] = [
    .percent(0.4),
    .percent(0.83),
  ]
}

enum BottomSheetSnapPoint {
  case percent(CGFloat)
  case absolute(CGFloat)

  func resolveHeight(maxHeight: CGFloat) -> CGFloat {
    switch self {
    case .percent(let ratio):
      return (ratio.clamped(to: 0...1)) * maxHeight
    case .absolute(let value):
      return max(0, value)
    }
  }

  static func parseList(_ values: [Any]?) -> [BottomSheetSnapPoint] {
    guard let values = values else { return [] }
    return values.compactMap(parse)
  }

  private static func parse(_ raw: Any) -> BottomSheetSnapPoint? {
    if let number = raw as? NSNumber {
      return .absolute(CGFloat(truncating: number))
    }
    guard let string = raw as? String else {
      return nil
    }
    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasSuffix("%"),
      let numeric = Double(trimmed.dropLast())
    {
      return .percent(CGFloat(numeric / 100).clamped(to: 0...1))
    }
    if let numeric = Double(trimmed) {
      return .absolute(CGFloat(numeric).clamped(to: 0...CGFloat.greatestFiniteMagnitude))
    }
    return nil
  }
}

extension CGFloat {
  fileprivate func clamped(to range: ClosedRange<CGFloat>) -> CGFloat {
    return Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
  }
}

private struct SnapDetent {
  let identifier: UISheetPresentationController.Detent.Identifier
  let detent: UISheetPresentationController.Detent
  let height: CGFloat
}
