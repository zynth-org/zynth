import UIKit

enum BottomSheetSnapPoint {
  case percent(CGFloat)
  case absolute(CGFloat)

  func resolve(maxHeight: CGFloat) -> CGFloat {
    switch self {
    case .percent(let ratio):
      return maxHeight * ratio
    case .absolute(let value):
      return value
    }
  }

  static func parse(_ raw: Any) -> BottomSheetSnapPoint? {
    if let number = raw as? NSNumber {
      return .absolute(CGFloat(number.doubleValue))
    }
    if let str = raw as? String {
      let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.hasSuffix("%") {
        let value = trimmed.dropLast()
        if let ratio = Double(value) {
          return .percent(CGFloat(ratio / 100.0))
        }
      } else if let value = Double(trimmed) {
        return .absolute(CGFloat(value))
      }
    }
    return nil
  }

  static func parseList(_ values: NSArray?) -> [BottomSheetSnapPoint] {
    guard let values else { return [] }
    return values.compactMap { parse($0) }
  }
}

struct ZynthBottomSheetOptions {
  var snapPoints: [BottomSheetSnapPoint] = [
    .percent(0.3),
    .percent(0.64),
    .percent(0.9),
  ]
  var initialSnapIndex: Int = 0
  var allowBackgroundInteraction: Bool = false
  var allowDismissOnInteraction: Bool = true
}

@available(iOS 16.0, *)
final class ZynthBottomSheetPresenter: NSObject {
  private weak var host: ZynthBottomSheetView?
  private let contentHost: UIView
  private var options = ZynthBottomSheetOptions()
  private var contentController: ZynthBottomSheetContentViewController?
  private var isOpen = false
  private var detentIdentifiers: [UISheetPresentationController.Detent.Identifier] = []
  private var resolvedHeights: [CGFloat] = []

  init(contentHost: UIView, host: ZynthBottomSheetView) {
    self.contentHost = contentHost
    self.host = host
    super.init()
  }

  func updateOptions(_ newOptions: ZynthBottomSheetOptions) {
    options = newOptions
    guard let controller = contentController else { return }
    configureSheet(for: controller, selectedIndex: nil)
  }

  func setOpenState(_ open: Bool, preferredIndex: Int?) {
    if open {
      present(index: preferredIndex)
    } else {
      dismiss()
    }
  }

  func present(index: Int?) {
    DispatchQueue.main.async { [weak self] in
      self?.presentInternal(index: index)
    }
  }

  func dismiss() {
    DispatchQueue.main.async { [weak self] in
      self?.dismissInternal()
    }
  }

  func snapTo(index: Int) {
    DispatchQueue.main.async { [weak self] in
      self?.snapToInternal(index: index)
    }
  }

  func reset() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if let controller = self.contentController {
        controller.dismiss(animated: false) { [weak self] in
          self?.completeDismiss()
        }
      } else {
        self.completeDismiss()
      }
    }
  }

  private func presentInternal(index: Int?) {
    guard !isOpen else {
      snapToInternal(index: index ?? options.initialSnapIndex)
      return
    }
    guard let presenter = topViewController() else { return }
    isOpen = true

    let controller = ZynthBottomSheetContentViewController(contentHost: contentHost)
    controller.modalPresentationStyle = .pageSheet
    controller.presentationController?.delegate = self

    configureSheet(for: controller, selectedIndex: index ?? options.initialSnapIndex)
    contentController = controller

    presenter.present(controller, animated: true) { [weak self] in
      self?.host?.dispatchEvent("onOpenChange", payload: ["open": true])
    }
  }

  private func dismissInternal() {
    guard isOpen, let controller = contentController else { return }
    controller.dismiss(animated: true) { [weak self] in
      self?.completeDismiss()
    }
  }

  private func completeDismiss() {
    guard isOpen else { return }
    isOpen = false
    if let controller = contentController, let host = host {
      controller.detachContent(to: host)
    }
    contentController = nil
    host?.dispatchEvent("onOpenChange", payload: ["open": false])
    host?.dispatchEvent("onDismiss", payload: nil)
  }

  private func snapToInternal(index: Int) {
    guard let controller = contentController else { return }
    guard let sheet = controller.sheetPresentationController else { return }
    let target = normalizedIndex(index)
    if target < detentIdentifiers.count {
      sheet.animateChanges {
        sheet.selectedDetentIdentifier = detentIdentifiers[target]
      }
    }
  }

  private func configureSheet(
    for controller: ZynthBottomSheetContentViewController,
    selectedIndex: Int?
  ) {
    guard let sheet = controller.sheetPresentationController else { return }
    let detents = makeDetents()
    sheet.detents = detents
    sheet.prefersGrabberVisible = options.allowDismissOnInteraction
    sheet.prefersScrollingExpandsWhenScrolledToEdge = false
    sheet.largestUndimmedDetentIdentifier =
      options.allowBackgroundInteraction ? detentIdentifiers.last : nil
    controller.isModalInPresentation = !options.allowDismissOnInteraction
    sheet.delegate = self
    if let selectedIndex {
      let normalized = normalizedIndex(selectedIndex)
      if normalized < detentIdentifiers.count {
        sheet.selectedDetentIdentifier = detentIdentifiers[normalized]
      }
    }
  }

  private func makeDetents() -> [UISheetPresentationController.Detent] {
    let snapPoints = options.snapPoints.isEmpty
      ? ZynthBottomSheetOptions().snapPoints
      : options.snapPoints
    let screenHeight = UIScreen.main.bounds.height
    resolvedHeights = snapPoints.map {
      $0.resolve(maxHeight: screenHeight).clamped(to: 0...screenHeight)
    }

    detentIdentifiers = snapPoints.enumerated().map { index, _ in
      UISheetPresentationController.Detent.Identifier("zynth-bottom-sheet-\(index)")
    }

    return snapPoints.enumerated().map { index, point in
      let identifier = detentIdentifiers[index]
      return .custom(identifier: identifier) { context in
        let height = point.resolve(maxHeight: context.maximumDetentValue)
        return height.clamped(to: 0...context.maximumDetentValue)
      }
    }
  }

  private func normalizedIndex(_ index: Int) -> Int {
    let maxIndex = max(0, detentIdentifiers.count - 1)
    return min(max(index, 0), maxIndex)
  }

  private func emitSnapChange(for identifier: UISheetPresentationController.Detent.Identifier?) {
    guard let identifier else { return }
    guard let index = detentIdentifiers.firstIndex(of: identifier) else { return }
    let maxHeight = resolvedHeights.max() ?? 0
    let height = index < resolvedHeights.count ? resolvedHeights[index] : 0
    let progress = maxHeight > 0 ? (height / maxHeight) : 0
    host?.dispatchEvent("onSnapChange", payload: [
      "index": index,
      "progress": progress,
    ])
  }

  private func topViewController() -> UIViewController? {
    if let vc = host?.window?.rootViewController {
      return topController(from: vc)
    }

    if #available(iOS 13.0, *) {
      let scenes = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
      for scene in scenes where scene.activationState == .foregroundActive {
        if let top = topController(
          from: scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
        ) {
          return top
        }
      }
    }

    let fallback = topController(
      from: UIApplication.shared.windows.first(where: { $0.isKeyWindow })?.rootViewController
    )
    return fallback
  }

  private func topController(from controller: UIViewController?) -> UIViewController? {
    let candidate: UIViewController?
    if let nav = controller as? UINavigationController {
      candidate = nav.visibleViewController
    } else if let tab = controller as? UITabBarController {
      candidate = tab.selectedViewController
    } else {
      candidate = controller
    }

    if let presented = candidate?.presentedViewController {
      return topController(from: presented)
    }
    return candidate
  }
}

@available(iOS 16.0, *)
extension ZynthBottomSheetPresenter: UISheetPresentationControllerDelegate {
  func sheetPresentationControllerDidChangeSelectedDetentIdentifier(
    _ sheetPresentationController: UISheetPresentationController
  ) {
    emitSnapChange(for: sheetPresentationController.selectedDetentIdentifier)
  }
}

@available(iOS 16.0, *)
extension ZynthBottomSheetPresenter: UIAdaptivePresentationControllerDelegate {
  func presentationControllerShouldDismiss(
    _ presentationController: UIPresentationController
  ) -> Bool {
    return options.allowDismissOnInteraction
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    completeDismiss()
  }
}

private extension CGFloat {
  func clamped(to range: ClosedRange<CGFloat>) -> CGFloat {
    return Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
  }
}
