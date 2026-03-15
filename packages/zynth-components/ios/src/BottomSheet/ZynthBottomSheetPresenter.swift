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
  var overlayColor: UIColor = .black
  var overlayOpacity: CGFloat = 0.58
  var showOverlay: Bool = true
  var dismissOnOverlayPress: Bool = true
  var initialSnapIndex: Int = 0
  var allowBackgroundInteraction: Bool = false
  var allowDismissOnInteraction: Bool = true
  var dynamicContentHeight: Bool = false
  var contentHeightHint: CGFloat? = nil
}

@available(iOS 16.0, *)
final class ZynthBottomSheetPresenter: NSObject {
  private weak var host: ZynthBottomSheetView?
  private let contentHost: UIView
  private var options = ZynthBottomSheetOptions()
  private var contentController: ZynthBottomSheetContentViewController?
  private weak var systemDimmingView: UIView?
  private lazy var overlayTapGesture: UITapGestureRecognizer = {
    let gesture = UITapGestureRecognizer(target: self, action: #selector(handleOverlayTap))
    gesture.cancelsTouchesInView = false
    return gesture
  }()
  private var isOpen = false
  private var pendingIndex = 0
  private var currentReportedIndex = 0
  private var lastProgress: CGFloat = 0
  private var detentIdentifiers: [UISheetPresentationController.Detent.Identifier] = []
  private var resolvedHeights: [CGFloat] = []
  private var detentRevision: Int = 0
  private var measuredContentHeight: CGFloat = 0
  private var bottomSafeAreaInset: CGFloat = 0

  init(contentHost: UIView, host: ZynthBottomSheetView) {
    self.contentHost = contentHost
    self.host = host
    super.init()
  }

  func updateOptions(_ newOptions: ZynthBottomSheetOptions) {
    options = newOptions
    rebuildDetents()
    guard let controller = contentController else { return }
    guard let sheet = controller.sheetPresentationController else {
      configureSheet(for: controller, selectedIndex: pendingIndex)
      return
    }

    // Keep live option updates in-sync while the sheet is already presented.
    if isOpen {
      let detents = makeDetents()
      let selected = detentIdentifiers[normalizedIndex(pendingIndex)]
      sheet.invalidateDetents()
      sheet.animateChanges {
        sheet.detents = detents
        sheet.selectedDetentIdentifier = selected
      }
      sheet.prefersGrabberVisible = true
      sheet.prefersScrollingExpandsWhenScrolledToEdge = false
      sheet.largestUndimmedDetentIdentifier = options.allowBackgroundInteraction
        ? detentIdentifiers.last
        : nil
      controller.isModalInPresentation = !options.allowDismissOnInteraction
      updateSystemDimmingViewState()
      return
    }

    configureSheet(for: controller, selectedIndex: pendingIndex)
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

  func expand() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if !self.isOpen {
        self.present(index: max(self.detentIdentifiers.count - 1, 0))
        return
      }
      self.snapToInternal(index: max(self.detentIdentifiers.count - 1, 0))
    }
  }

  func collapse() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if !self.isOpen {
        return
      }
      self.snapToInternal(index: 0)
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
    let normalized = normalizedIndex(index ?? options.initialSnapIndex)
    pendingIndex = normalized
    guard !isOpen else {
      snapToInternal(index: normalized)
      return
    }
    guard let presenter = topViewController() else {
      return
    }

    isOpen = true
    print("[ZynthBottomSheet] presentInternal called, pendingIndex=\(pendingIndex)")

    let controller = ZynthBottomSheetContentViewController(contentHost: contentHost)
    controller.presenter = self
    controller.modalPresentationStyle = .pageSheet
    controller.presentationController?.delegate = self

    contentController = controller
    configureSheet(for: controller, selectedIndex: normalized)
    
    currentReportedIndex = normalized
    lastProgress = 0

    presenter.present(controller, animated: true) { [weak self] in
      self?.host?.dispatchEvent("onOpenChange", payload: ["open": true])
      self?.updateSystemDimmingViewState()
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
    detachSystemDimmingView()
    if let controller = contentController, let host = host {
      controller.detachContent(to: host)
    }
    let lastIndex = currentReportedIndex
    pendingIndex = 0
    currentReportedIndex = 0
    lastProgress = 0
    contentController = nil
    host?.dispatchEvent("onSnapChange", payload: [
      "index": lastIndex,
      "progress": 0,
    ])
    host?.dispatchEvent("onOpenChange", payload: ["open": false])
    host?.dispatchEvent("onDismiss", payload: nil)
  }

  private func snapToInternal(index: Int) {
    guard let controller = contentController else { return }
    guard let sheet = controller.sheetPresentationController else { return }
    let target = normalizedIndex(index)
    pendingIndex = target
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
    controller.presentationController?.delegate = self
    let detents = makeDetents()
    sheet.detents = detents
    sheet.prefersGrabberVisible = true
    sheet.prefersScrollingExpandsWhenScrolledToEdge = false
    
    let undimmedId = options.allowBackgroundInteraction ? detentIdentifiers.last : nil
    sheet.largestUndimmedDetentIdentifier = undimmedId

    controller.isModalInPresentation = !options.allowDismissOnInteraction
    
    controller.view.backgroundColor = .clear
    sheet.delegate = self
    if let selectedIndex {
      let normalized = normalizedIndex(selectedIndex)
      if normalized < detentIdentifiers.count {
        sheet.selectedDetentIdentifier = detentIdentifiers[normalized]
      }
    }
    updateSystemDimmingViewState()
  }

  private func rebuildDetents() {
    detentRevision += 1
    let snapPoints = options.snapPoints.isEmpty
      ? (options.dynamicContentHeight ? [] : ZynthBottomSheetOptions().snapPoints)
      : options.snapPoints
    let screenHeight = UIScreen.main.bounds.height
    let hintedHeight = max(options.contentHeightHint ?? 0, 0)
    let sourceHeight = max(measuredContentHeight, hintedHeight)
    let contentCap: CGFloat
    if options.dynamicContentHeight, sourceHeight > 0 {
      contentCap = min(screenHeight, sourceHeight)
    } else {
      contentCap = screenHeight
    }
    let dynamicSafeAreaCompensation = options.dynamicContentHeight
      ? min(max(bottomSafeAreaInset, 0), contentCap)
      : 0
    let effectiveContentCap = max(contentCap - dynamicSafeAreaCompensation, 1)
    print(
      "[ZynthBottomSheet] rebuildDetents dynamic=\(options.dynamicContentHeight) measured=\(measuredContentHeight) hint=\(hintedHeight) contentCap=\(contentCap) effectiveCap=\(effectiveContentCap) safeBottom=\(bottomSafeAreaInset) screen=\(screenHeight) snapCount=\(snapPoints.count)"
    )
    if options.dynamicContentHeight && snapPoints.isEmpty {
      resolvedHeights = [effectiveContentCap]
      detentIdentifiers = [
        UISheetPresentationController.Detent.Identifier(
          "zynth-bottom-sheet-\(detentRevision)-0"
        ),
      ]
      return
    }
    resolvedHeights = snapPoints.map {
      $0.resolve(maxHeight: screenHeight).clamped(to: 0...effectiveContentCap)
    }.filter { $0 > 0 }
    resolvedHeights.sort()
    var uniqueHeights: [CGFloat] = []
    for height in resolvedHeights where uniqueHeights.last != height {
      uniqueHeights.append(height)
    }
    if uniqueHeights.isEmpty {
      uniqueHeights = [effectiveContentCap]
    }
    resolvedHeights = uniqueHeights
    detentIdentifiers = uniqueHeights.enumerated().map { index, _ in
      UISheetPresentationController.Detent.Identifier(
        "zynth-bottom-sheet-\(detentRevision)-\(index)"
      )
    }
  }

  private func makeDetents() -> [UISheetPresentationController.Detent] {
    if resolvedHeights.isEmpty {
      rebuildDetents()
    }
    return resolvedHeights.enumerated().map { index, height in
      let identifier = detentIdentifiers[index]
      return .custom(identifier: identifier) { context in
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
    currentReportedIndex = index
    lastProgress = progress
    host?.dispatchEvent("onSnapChange", payload: [
      "index": index,
      "progress": progress,
    ])
    updateSystemDimmingViewState()
  }

  func sheetDidLayout(height: CGFloat) {
    guard isOpen, let maxHeight = resolvedHeights.last, maxHeight > 0 else { return }
    let visible = min(max(height, 0), maxHeight)
    let progress = visible / maxHeight
    let previous = lastProgress
    lastProgress = progress
    let nearest = nearestIndex(for: visible)
    if nearest != currentReportedIndex || abs(progress - previous) > 0.001 {
      currentReportedIndex = nearest
      host?.dispatchEvent("onSnapChange", payload: [
        "index": nearest,
        "progress": progress,
      ])
    }
    updateSystemDimmingViewState()
  }

  func contentHeightDidChange(height: CGFloat, bottomSafeAreaInset: CGFloat) {
    let normalizedHeight = max(height, 0)
    let normalizedSafeAreaBottom = max(bottomSafeAreaInset, 0)
    let previousMeasuredHeight = measuredContentHeight
    if abs(normalizedHeight - measuredContentHeight) <= 1 &&
      abs(normalizedSafeAreaBottom - self.bottomSafeAreaInset) <= 1
    {
      return
    }
    if abs(normalizedHeight - measuredContentHeight) <= 1 {
      self.bottomSafeAreaInset = normalizedSafeAreaBottom
    } else {
      measuredContentHeight = normalizedHeight
      self.bottomSafeAreaInset = normalizedSafeAreaBottom
    }
    print(
      "[ZynthBottomSheet] contentHeightDidChange=\(measuredContentHeight) safeBottom=\(self.bottomSafeAreaInset) isOpen=\(isOpen)"
    )
    guard options.dynamicContentHeight else { return }
    guard let controller = contentController else { return }
    guard let sheet = controller.sheetPresentationController else { return }
    rebuildDetents()
    if normalizedHeight > previousMeasuredHeight + 1 {
      pendingIndex = max(pendingIndex, detentIdentifiers.count - 1)
    }
    let detents = makeDetents()
    let selected = detentIdentifiers[normalizedIndex(pendingIndex)]
    sheet.invalidateDetents()
    sheet.animateChanges {
      sheet.detents = detents
      sheet.selectedDetentIdentifier = selected
    }
    updateSystemDimmingViewState()
  }

  private func nearestIndex(for height: CGFloat) -> Int {
    guard !resolvedHeights.isEmpty else { return 0 }
    var nearest = 0
    var bestDiff = CGFloat.greatestFiniteMagnitude
    for (index, detentHeight) in resolvedHeights.enumerated() {
      let diff = abs(detentHeight - height)
      if diff < bestDiff {
        bestDiff = diff
        nearest = index
      }
    }
    return nearest
  }

  @objc private func handleOverlayTap() {
    guard options.dismissOnOverlayPress &&
      options.allowDismissOnInteraction &&
      !options.allowBackgroundInteraction else { return }
    dismiss()
  }

  private func updateSystemDimmingViewState() {
    // If allowBackgroundInteraction is true, we must ensure the system dimming view is hidden.
    // Even though largestUndimmedDetentIdentifier SHOULD handle this, sometimes we need to clear our own modifications
    // or help the system out if we've touched the view before.
    if options.allowBackgroundInteraction {
      if let container = contentController?.presentationController?.containerView,
         let dimmingView = resolveSystemDimmingView(in: container) {
        dimmingView.isHidden = true
        dimmingView.alpha = 0
        dimmingView.isUserInteractionEnabled = false
      }
      detachSystemDimmingView()
      return
    }

    guard let container = contentController?.presentationController?.containerView else { return }
    guard let dimmingView = resolveSystemDimmingView(in: container) else { return }

    if !options.showOverlay || options.overlayOpacity <= 0.001 {
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
    let candidates = container.subviews.filter { $0 !== sheetView }
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
  func presentationControllerWillBeginPresentation(
    _ presentationController: UIPresentationController
  ) {
    updateSystemDimmingViewState()
  }

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
