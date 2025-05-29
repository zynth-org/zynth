import RuneKit
import UIKit

@available(iOS 16.0, *)
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

  static func parseList(_ values: NSArray?) -> [BottomSheetSnapPoint] {
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

@available(iOS 16.0, *)
struct RuneBottomSheetOptions {
  var snapPoints: [BottomSheetSnapPoint] = RuneBottomSheetOptions.defaultSnapPoints
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

struct BottomSheetColorParser {
  static func color(from value: String?) -> UIColor? {
    guard var hex = value?.trimmingCharacters(in: .whitespacesAndNewlines),
      hex.hasPrefix("#")
    else {
      return nil
    }
    hex.removeFirst()
    let scanner = Scanner(string: hex)
    var hexNumber: UInt64 = 0
    guard scanner.scanHexInt64(&hexNumber) else { return nil }

    switch hex.count {
    case 3:  // RGB -> RRGGBB
      let r = (hexNumber & 0xF00) >> 8
      let g = (hexNumber & 0x0F0) >> 4
      let b = hexNumber & 0x00F
      return UIColor(
        red: CGFloat((r << 4) + r) / 255,
        green: CGFloat((g << 4) + g) / 255,
        blue: CGFloat((b << 4) + b) / 255,
        alpha: 1
      )
    case 4:  // ARGB -> AARRGGBB
      let a = (hexNumber & 0xF000) >> 12
      let r = (hexNumber & 0x0F00) >> 8
      let g = (hexNumber & 0x00F0) >> 4
      let b = hexNumber & 0x000F
      return UIColor(
        red: CGFloat((r << 4) + r) / 255,
        green: CGFloat((g << 4) + g) / 255,
        blue: CGFloat((b << 4) + b) / 255,
        alpha: CGFloat((a << 4) + a) / 255
      )
    case 6:
      return colorFromComponents(
        red: (hexNumber & 0xFF0000) >> 16,
        green: (hexNumber & 0x00FF00) >> 8,
        blue: hexNumber & 0x0000FF,
        alpha: 0xFF
      )
    case 8:
      return colorFromComponents(
        red: (hexNumber & 0x00FF_0000) >> 16,
        green: (hexNumber & 0x0000_FF00) >> 8,
        blue: hexNumber & 0x0000_00FF,
        alpha: (hexNumber & 0xFF00_0000) >> 24
      )
    default:
      return nil
    }
  }

  private static func colorFromComponents(
    red: UInt64,
    green: UInt64,
    blue: UInt64,
    alpha: UInt64
  ) -> UIColor {
    return UIColor(
      red: CGFloat(red) / 255,
      green: CGFloat(green) / 255,
      blue: CGFloat(blue) / 255,
      alpha: CGFloat(alpha) / 255
    )
  }
}

extension CGFloat {
  func clamped(to range: ClosedRange<CGFloat>) -> CGFloat {
    return Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
  }
}

private struct SnapDetent {
  let identifier: UISheetPresentationController.Detent.Identifier
  let detent: UISheetPresentationController.Detent
  let height: CGFloat
}

@available(iOS 16.0, *)
final class RuneBottomSheetPresenter: NSObject {
  private weak var host: RuneBottomSheetView?
  private let contentHost: UIView
  private var options = RuneBottomSheetOptions()
  private var detentInfo: [SnapDetent] = []
  private var contentController: RuneBottomSheetContentViewController?
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

  init(contentHost: UIView, host: RuneBottomSheetView) {
    self.contentHost = contentHost
    self.host = host
    super.init()
  }

  func updateOptions(_ newOptions: RuneBottomSheetOptions) {
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
    guard isSheetOpen, let controller = contentController else {

      return
    }

    controller.dismiss(animated: true) { [weak self] in
      self?.completeDismiss()
    }
  }

  func reset() {
    DispatchQueue.main.async { [weak self] in
      self?.contentController?.dismiss(animated: false) { [weak self] in
        self?.completeDismiss()
      }
      self?.detachSystemDimmingView()
      self?.isSheetOpen = false
    }
  }

  private func presentInternal(index: Int?) {
    let normalized = normalizedIndex(index ?? options.initialSnapIndex)
    pendingIndex = normalized

    if isSheetOpen {
      snapTo(index: normalized)
      return
    }

    guard let controller = topViewController(), host != nil else {

      return
    }

    let sheet = RuneBottomSheetContentViewController(contentHost: contentHost)
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

    controller.present(sheet, animated: true) { [weak self] in
      guard let self = self else { return }

      self.host?.dispatchEvent("onOpenChange", payload: ["open": true])
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

  private func detentIdentifier(for index: Int) -> UISheetPresentationController.Detent.Identifier?
  {
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
      host?.dispatchEvent(
        "onSnapChange",
        payload: ["index": nearest, "progress": progress]
      )

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
    let lastIndex = currentReportedIndex
    pendingIndex = 0
    currentReportedIndex = 0
    lastProgress = 0
    host?.dispatchEvent(
      "onSnapChange",
      payload: [
        "index": lastIndex,
        "progress": 0,
      ]
    )
    host?.dispatchEvent("onOpenChange", payload: ["open": false])
    host?.dispatchEvent("onDismiss", payload: nil)

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
          from: scene.windows.first(where: { $0.isKeyWindow })?.rootViewController)
        {

          return top
        }
      }
    }
    let fallback = topController(
      from: UIApplication.shared.windows.first(where: { $0.isKeyWindow })?.rootViewController)
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
extension RuneBottomSheetPresenter: UISheetPresentationControllerDelegate {}

@available(iOS 16.0, *)
extension RuneBottomSheetPresenter: UIAdaptivePresentationControllerDelegate {
  func presentationControllerWillBeginPresentation(
    _ presentationController: UIPresentationController
  ) {
    updateSystemDimmingViewState()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    completeDismiss()
  }

  func presentationControllerShouldDismiss(_ presentationController: UIPresentationController)
    -> Bool
  {
    return options.allowDismissOnInteraction
  }
}
