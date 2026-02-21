import Foundation
import UIKit
import ZynthKit

@objc(ZynthGestureDetectorView)
@objcMembers
public final class ZynthGestureDetectorView: UIView, UIGestureRecognizerDelegate {
  private weak var manager: ZynthUIManager?
  private weak var node: ZynthNode?

  private var tapEnabled = false
  private var longPressEnabled = false
  private var rotationEnabled = false
  private var pinchEnabled = false
  private var flingEnabled = false
  private var panEnabled = false

  private var longPressMinDurationMs: Double = 500
  private var flingMinVelocity: Double = 800
  private var panSharedSignalX: Int = 0
  private var panSharedSignalY: Int = 0
  private var panSignalBaseX: Double = 0
  private var panSignalBaseY: Double = 0
  private var panSignalCurrentX: Double = 0
  private var panSignalCurrentY: Double = 0

  private var longPressStartTimestamp: Double = 0

  private lazy var tapRecognizer: UITapGestureRecognizer = {
    let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    recognizer.cancelsTouchesInView = false
    recognizer.delegate = self
    recognizer.isEnabled = false
    return recognizer
  }()

  private lazy var longPressRecognizer: UILongPressGestureRecognizer = {
    let recognizer = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
    recognizer.minimumPressDuration = longPressMinDurationMs / 1000.0
    recognizer.cancelsTouchesInView = false
    recognizer.delegate = self
    recognizer.isEnabled = false
    return recognizer
  }()

  private lazy var panRecognizer: UIPanGestureRecognizer = {
    let recognizer = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    recognizer.minimumNumberOfTouches = 1
    recognizer.maximumNumberOfTouches = 2
    recognizer.cancelsTouchesInView = false
    recognizer.delegate = self
    recognizer.isEnabled = false
    return recognizer
  }()

  private lazy var pinchRecognizer: UIPinchGestureRecognizer = {
    let recognizer = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
    recognizer.cancelsTouchesInView = false
    recognizer.delegate = self
    recognizer.isEnabled = false
    return recognizer
  }()

  private lazy var rotationRecognizer: UIRotationGestureRecognizer = {
    let recognizer = UIRotationGestureRecognizer(target: self, action: #selector(handleRotation(_:)))
    recognizer.cancelsTouchesInView = false
    recognizer.delegate = self
    recognizer.isEnabled = false
    return recognizer
  }()

  override public init(frame: CGRect) {
    super.init(frame: frame)
    setupRecognizers()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    setupRecognizers()
  }

  private func setupRecognizers() {
    addGestureRecognizer(tapRecognizer)
    addGestureRecognizer(longPressRecognizer)
    addGestureRecognizer(panRecognizer)
    addGestureRecognizer(pinchRecognizer)
    addGestureRecognizer(rotationRecognizer)
  }

  public func bindWithManager(_ manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
  }

  public func setLongPressMinDurationMsValue(_ value: Double) {
    longPressMinDurationMs = max(0, value)
    longPressRecognizer.minimumPressDuration = longPressMinDurationMs / 1000.0
  }

  public func setFlingMinVelocityValue(_ value: Double) {
    flingMinVelocity = max(0, value)
  }

  public func setPanSharedSignalXValue(_ value: Int) {
    panSharedSignalX = value > 0 ? value : 0
  }

  public func setPanSharedSignalYValue(_ value: Int) {
    panSharedSignalY = value > 0 ? value : 0
  }

  public func enableEventWithName(_ name: String) {
    switch name {
    case "onTapGesture":
      tapEnabled = true
    case "onLongPressGesture":
      longPressEnabled = true
    case "onRotationGesture":
      rotationEnabled = true
    case "onPinchGesture":
      pinchEnabled = true
    case "onFlingGesture":
      flingEnabled = true
    case "onPanGesture":
      panEnabled = true
    default:
      break
    }
    updateRecognizerState()
  }

  public func cleanup() {
    manager = nil
    node = nil
    tapEnabled = false
    longPressEnabled = false
    rotationEnabled = false
    pinchEnabled = false
    flingEnabled = false
    panEnabled = false
    longPressStartTimestamp = 0
    longPressMinDurationMs = 500
    flingMinVelocity = 800
    panSharedSignalX = 0
    panSharedSignalY = 0
    panSignalBaseX = 0
    panSignalBaseY = 0
    panSignalCurrentX = 0
    panSignalCurrentY = 0
    updateRecognizerState()
  }

  private func updateRecognizerState() {
    tapRecognizer.isEnabled = tapEnabled
    longPressRecognizer.isEnabled = longPressEnabled
    pinchRecognizer.isEnabled = pinchEnabled
    rotationRecognizer.isEnabled = rotationEnabled
    panRecognizer.isEnabled = panEnabled || flingEnabled
  }

  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    return true
  }

  @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
    guard tapEnabled else { return }
    guard recognizer.state == .ended else { return }

    var payload = basePayload(for: recognizer, phase: "end")
    payload["numberOfTaps"] = recognizer.numberOfTapsRequired
    emit("onTapGesture", payload: payload)
  }

  @objc private func handleLongPress(_ recognizer: UILongPressGestureRecognizer) {
    guard longPressEnabled else { return }

    switch recognizer.state {
    case .began:
      longPressStartTimestamp = nowMs()
      var payload = basePayload(for: recognizer, phase: "start")
      payload["durationMs"] = longPressMinDurationMs
      emit("onLongPressGesture", payload: payload)

    case .ended:
      let duration = max(0, nowMs() - longPressStartTimestamp)
      var endPayload = basePayload(for: recognizer, phase: "end")
      endPayload["durationMs"] = duration
      emit("onLongPressGesture", payload: endPayload)

      var deactivatePayload = endPayload
      deactivatePayload["phase"] = "deactivate"
      emit("onLongPressGesture", payload: deactivatePayload)

    case .cancelled, .failed:
      let duration = max(0, nowMs() - longPressStartTimestamp)
      var payload = basePayload(for: recognizer, phase: "deactivate")
      payload["durationMs"] = duration
      emit("onLongPressGesture", payload: payload)

    default:
      break
    }
  }

  @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
    let translation = recognizer.translation(in: self)
    let velocity = recognizer.velocity(in: self)

    if panEnabled {
      switch recognizer.state {
      case .began:
        syncPanSignalBaseFromNative()
        panSignalBaseX = panSignalCurrentX
        panSignalBaseY = panSignalCurrentY
        updateNativePanSignals(translationX: translation.x, translationY: translation.y)
        var payload = basePayload(for: recognizer, phase: "start")
        payload["translationX"] = toDp(translation.x)
        payload["translationY"] = toDp(translation.y)
        payload["velocityX"] = toDp(velocity.x)
        payload["velocityY"] = toDp(velocity.y)
        emit("onPanGesture", payload: payload)

      case .changed:
        updateNativePanSignals(translationX: translation.x, translationY: translation.y)
        var payload = basePayload(for: recognizer, phase: "update")
        payload["translationX"] = toDp(translation.x)
        payload["translationY"] = toDp(translation.y)
        payload["velocityX"] = toDp(velocity.x)
        payload["velocityY"] = toDp(velocity.y)
        emit("onPanGesture", payload: payload)

      case .ended:
        updateNativePanSignals(translationX: translation.x, translationY: translation.y)
        var endPayload = basePayload(for: recognizer, phase: "end")
        endPayload["translationX"] = toDp(translation.x)
        endPayload["translationY"] = toDp(translation.y)
        endPayload["velocityX"] = toDp(velocity.x)
        endPayload["velocityY"] = toDp(velocity.y)
        emit("onPanGesture", payload: endPayload)

        var deactivatePayload = endPayload
        deactivatePayload["phase"] = "deactivate"
        emit("onPanGesture", payload: deactivatePayload)
        panSignalBaseX = panSignalCurrentX
        panSignalBaseY = panSignalCurrentY

      case .cancelled, .failed:
        updateNativePanSignals(translationX: translation.x, translationY: translation.y)
        var payload = basePayload(for: recognizer, phase: "deactivate")
        payload["translationX"] = toDp(translation.x)
        payload["translationY"] = toDp(translation.y)
        payload["velocityX"] = toDp(velocity.x)
        payload["velocityY"] = toDp(velocity.y)
        emit("onPanGesture", payload: payload)
        panSignalBaseX = panSignalCurrentX
        panSignalBaseY = panSignalCurrentY

      default:
        break
      }
    }

    if flingEnabled && recognizer.state == .ended {
      let vx = toDp(velocity.x)
      let vy = toDp(velocity.y)
      let speed = hypot(vx, vy)
      if speed >= flingMinVelocity {
        let direction: String
        if abs(vx) >= abs(vy) {
          direction = vx >= 0 ? "right" : "left"
        } else {
          direction = vy >= 0 ? "down" : "up"
        }

        var payload = basePayload(for: recognizer, phase: "end")
        payload["velocityX"] = vx
        payload["velocityY"] = vy
        payload["direction"] = direction
        emit("onFlingGesture", payload: payload)
      }
    }
  }

  @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
    guard pinchEnabled else { return }

    switch recognizer.state {
    case .began:
      var payload = basePayload(for: recognizer, phase: "start")
      payload["scale"] = recognizer.scale
      payload["velocity"] = recognizer.velocity
      payload["focalX"] = payload["x"]
      payload["focalY"] = payload["y"]
      emit("onPinchGesture", payload: payload)

    case .changed:
      var payload = basePayload(for: recognizer, phase: "update")
      payload["scale"] = recognizer.scale
      payload["velocity"] = recognizer.velocity
      payload["focalX"] = payload["x"]
      payload["focalY"] = payload["y"]
      emit("onPinchGesture", payload: payload)

    case .ended:
      var endPayload = basePayload(for: recognizer, phase: "end")
      endPayload["scale"] = recognizer.scale
      endPayload["velocity"] = recognizer.velocity
      endPayload["focalX"] = endPayload["x"]
      endPayload["focalY"] = endPayload["y"]
      emit("onPinchGesture", payload: endPayload)

      var deactivatePayload = endPayload
      deactivatePayload["phase"] = "deactivate"
      emit("onPinchGesture", payload: deactivatePayload)

    case .cancelled, .failed:
      var payload = basePayload(for: recognizer, phase: "deactivate")
      payload["scale"] = recognizer.scale
      payload["velocity"] = recognizer.velocity
      payload["focalX"] = payload["x"]
      payload["focalY"] = payload["y"]
      emit("onPinchGesture", payload: payload)

    default:
      break
    }
  }

  @objc private func handleRotation(_ recognizer: UIRotationGestureRecognizer) {
    guard rotationEnabled else { return }

    switch recognizer.state {
    case .began:
      var payload = basePayload(for: recognizer, phase: "start")
      payload["rotation"] = recognizer.rotation
      payload["velocity"] = recognizer.velocity
      payload["anchorX"] = payload["x"]
      payload["anchorY"] = payload["y"]
      emit("onRotationGesture", payload: payload)

    case .changed:
      var payload = basePayload(for: recognizer, phase: "update")
      payload["rotation"] = recognizer.rotation
      payload["velocity"] = recognizer.velocity
      payload["anchorX"] = payload["x"]
      payload["anchorY"] = payload["y"]
      emit("onRotationGesture", payload: payload)

    case .ended:
      var endPayload = basePayload(for: recognizer, phase: "end")
      endPayload["rotation"] = recognizer.rotation
      endPayload["velocity"] = recognizer.velocity
      endPayload["anchorX"] = endPayload["x"]
      endPayload["anchorY"] = endPayload["y"]
      emit("onRotationGesture", payload: endPayload)

      var deactivatePayload = endPayload
      deactivatePayload["phase"] = "deactivate"
      emit("onRotationGesture", payload: deactivatePayload)

    case .cancelled, .failed:
      var payload = basePayload(for: recognizer, phase: "deactivate")
      payload["rotation"] = recognizer.rotation
      payload["velocity"] = recognizer.velocity
      payload["anchorX"] = payload["x"]
      payload["anchorY"] = payload["y"]
      emit("onRotationGesture", payload: payload)

    default:
      break
    }
  }

  private func basePayload(for recognizer: UIGestureRecognizer, phase: String) -> [String: Any] {
    let local = recognizer.location(in: self)
    let screenView = window ?? self
    let screen = recognizer.location(in: screenView)
    return [
      "phase": phase,
      "timestamp": nowMs(),
      "x": toDp(local.x),
      "y": toDp(local.y),
      "absoluteX": toDp(screen.x),
      "absoluteY": toDp(screen.y),
    ]
  }

  private func emit(_ name: String, payload: [String: Any]) {
    guard let manager = manager,
          let node = node else {
      return
    }

    manager.zynth_dispatchEvent(name, payload: payload as [AnyHashable: Any], to: node)
  }

  private func nowMs() -> Double {
    return Date().timeIntervalSince1970 * 1000.0
  }

  private func toDp(_ value: CGFloat) -> Double {
    return Double(value)
  }

  private func updateNativePanSignals(translationX: CGFloat, translationY: CGFloat) {
    guard let manager = manager else { return }
    let hasX = panSharedSignalX > 0
    let hasY = panSharedSignalY > 0
    if !hasX && !hasY { return }

    if hasX {
      let nextX = panSignalBaseX + toDp(translationX)
      manager.setSharedSignal(Int32(panSharedSignalX), value: nextX)
      panSignalCurrentX = nextX
    }
    if hasY {
      let nextY = panSignalBaseY + toDp(translationY)
      manager.setSharedSignal(Int32(panSharedSignalY), value: nextY)
      panSignalCurrentY = nextY
    }
  }

  private func syncPanSignalBaseFromNative() {
    guard let manager = manager else { return }
    if panSharedSignalX > 0,
       let value = manager.sharedSignalValue(Int32(panSharedSignalX)) {
      panSignalCurrentX = value.doubleValue
    }
    if panSharedSignalY > 0,
       let value = manager.sharedSignalValue(Int32(panSharedSignalY)) {
      panSignalCurrentY = value.doubleValue
    }
  }
}
