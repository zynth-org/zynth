import Foundation
import UIKit

private let dimensionsEventName = "zynth.dimensions.change"
private let baselineFontSize: CGFloat = 17.0

private struct DimensionMetrics: Equatable {
  let width: Double
  let height: Double
  let scale: Double
  let fontScale: Double

  func toDictionary() -> [String: Any] {
    [
      "width": width,
      "height": height,
      "scale": scale,
      "fontScale": fontScale,
    ]
  }
}

private struct DimensionsPayload: Equatable {
  let window: DimensionMetrics
  let screen: DimensionMetrics

  func toDictionary() -> [String: Any] {
    [
      "window": window.toDictionary(),
      "screen": screen.toDictionary(),
    ]
  }
}

final class ZynthDimensionsModule: NSObject, ZynthModule, ZynthSyncModule {
  let name: String = "Dimensions"

  private weak var runtime: ZynthRuntime?
  private weak var rootView: UIView?
  private var boundsObservation: NSKeyValueObservation?
  private var fontScaleObserver: NSObjectProtocol?
  private var lastPayload: DimensionsPayload?

  init(runtime: ZynthRuntime, rootView: UIView) {
    self.runtime = runtime
    self.rootView = rootView
    super.init()
  }

  var constantsToExport: [String: Any]? {
    guard let payload = capturePayload() else { return nil }
    return payload.toDictionary()
  }

  func initialize() {
    DispatchQueue.main.async { [weak self] in
      self?.startObserving()
    }
  }

  func invalidate() {
    DispatchQueue.main.async { [weak self] in
      self?.stopObserving()
    }
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "current":
      guard let payload = capturePayload() else {
        return ["error": "unavailable"]
      }
      return ["result": payload.toDictionary()]
    default:
      return [
        "error": "unknown_method",
        "method": method,
      ]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "current":
      guard let payload = capturePayload() else { return [:] }
      return payload.toDictionary()
    default:
      throw ZynthModuleError.syncNotSupported(module: name, method: method)
    }
  }

  private func startObserving() {
    stopObserving()

    guard let rootView else { return }

    boundsObservation = rootView.layer.observe(\.bounds, options: [.new]) { [weak self] _, _ in
      self?.emitIfChanged(reason: "bounds")
    }

    fontScaleObserver = NotificationCenter.default.addObserver(
      forName: UIContentSizeCategory.didChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.emitIfChanged(reason: "contentSizeCategory")
    }

    emitIfChanged(reason: "initial")
  }

  private func stopObserving() {
    boundsObservation?.invalidate()
    boundsObservation = nil
    if let token = fontScaleObserver {
      NotificationCenter.default.removeObserver(token)
      fontScaleObserver = nil
    }
  }

  private func emitIfChanged(reason _: String) {
    guard let payload = capturePayload() else { return }
    if let lastPayload, lastPayload == payload {
      return
    }
    lastPayload = payload
    runtime?.emitEvent(name: dimensionsEventName, payload: payload.toDictionary())
  }

  private func capturePayload() -> DimensionsPayload? {
    if Thread.isMainThread {
      return computePayload()
    }

    var payload: DimensionsPayload?
    DispatchQueue.main.sync { [weak self] in
      payload = self?.computePayload()
    }
    return payload
  }

  private func computePayload() -> DimensionsPayload {
    let scale = Double(UIScreen.main.scale)
    let fontScale = Double(currentFontScale())

    let screenBounds = UIScreen.main.bounds
    let screenMetrics = DimensionMetrics(
      width: Double(screenBounds.width),
      height: Double(screenBounds.height),
      scale: scale,
      fontScale: fontScale
    )

    let windowBounds: CGRect
    if let root = rootView, !root.bounds.isNull, root.bounds.width > 0, root.bounds.height > 0 {
      windowBounds = root.bounds
    } else if let bounds = bestWindowBounds() {
      windowBounds = bounds
    } else {
      windowBounds = screenBounds
    }

    let windowMetrics = DimensionMetrics(
      width: Double(windowBounds.width),
      height: Double(windowBounds.height),
      scale: scale,
      fontScale: fontScale
    )

    return DimensionsPayload(window: windowMetrics, screen: screenMetrics)
  }

  private func currentFontScale() -> Double {
    let preferred = UIFont.preferredFont(forTextStyle: .body).pointSize
    guard preferred > 0 else { return 1 }
    return Double(preferred / baselineFontSize)
  }

  private func bestWindowBounds() -> CGRect? {
    if #available(iOS 13.0, *) {
      let keyWindow = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first(where: { $0.isKeyWindow })
      if let bounds = keyWindow?.bounds, !bounds.isNull {
        return bounds
      }
    }
    return UIApplication.shared.delegate?.window??.bounds ?? UIApplication.shared.keyWindow?.bounds
  }
}
