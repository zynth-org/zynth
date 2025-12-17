//
//  RuneAnimateBridge.swift
//  RuneAnimate
//
//  Bridge module that exposes native animations to JavaScript
//  via the __modules.call() mechanism.
//

import Foundation
import UIKit
import RuneKit

private enum RuneAnimateEasing: String {
  case linear
  case ease
  case easeIn
  case easeOut
  case easeInOut
  case easeOutCubic

  func apply(_ t: Double) -> Double {
    let clamped = max(0.0, min(1.0, t))
    switch self {
    case .linear:
      return clamped
    case .ease:
      return clamped * clamped * (3.0 - 2.0 * clamped)
    case .easeIn:
      return clamped * clamped
    case .easeOut:
      let inv = 1.0 - clamped
      return 1.0 - inv * inv
    case .easeInOut:
      if clamped < 0.5 {
        return 2.0 * clamped * clamped
      }
      let inv = 1.0 - clamped
      return 1.0 - 2.0 * inv * inv
    case .easeOutCubic:
      let inv = 1.0 - clamped
      return 1.0 - inv * inv * inv
    }
  }
}

private struct RuneAnimatedStyle {
  var opacity: CGFloat?
  var translateX: CGFloat?
  var translateY: CGFloat?
  var scale: CGFloat?
  var scaleX: CGFloat?
  var scaleY: CGFloat?
  var rotate: CGFloat?
}

private struct RuneResolvedStyle {
  var opacity: CGFloat
  var translateX: CGFloat
  var translateY: CGFloat
  var scaleX: CGFloat
  var scaleY: CGFloat
  var rotate: CGFloat
}

private struct RuneResolvedKeyframe {
  let at: CGFloat
  let style: RuneResolvedStyle
  let easing: RuneAnimateEasing?
}

private struct RuneStyleAnimation {
  let nodeId: Int
  let animationId: Int
  let phase: String
  let from: RuneResolvedStyle
  let to: RuneResolvedStyle
  let frames: [RuneResolvedKeyframe]?
  let startTime: CFTimeInterval
  let duration: CFTimeInterval
  let easing: RuneAnimateEasing
}

final class RuneAnimateBridge: NSObject, RuneModule {
  let name = "RuneAnimate"

  private weak var runtime: RuneRuntime?
  private var displayLink: CADisplayLink?
  private var animations: [Int: RuneStyleAnimation] = [:]

  init(runtime: RuneRuntime) {
    self.runtime = runtime
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    case "startTransition":
      return handleStartTransition(args)
    case "stopTransition":
      return handleStopTransition(args)
    default:
      return errorResponse("unsupported_method", method)
    }
  }

  private func handleStartTransition(_ args: Any?) -> [String: Any] {
    guard let params = getDict(args) else {
      return errorResponse("invalid_argument", "params")
    }

    guard let nodeId = getInt(params["nodeId"]) else {
      return errorResponse("invalid_argument", "nodeId")
    }

    let animationId = getInt(params["animationId"]) ?? Int(Date().timeIntervalSince1970 * 1000)
    let phase = (params["phase"] as? String) ?? "enter"
    let durationMs = getDouble(params["duration"]) ?? 300
    let delayMs = getDouble(params["delay"]) ?? 0
    let easingName = (params["easing"] as? String) ?? "easeOutCubic"
    let easing = RuneAnimateEasing(rawValue: easingName) ?? .easeOutCubic

    let fromStyle = parseStyle(params["from"])
    let toStyle = parseStyle(params["to"])
    let frameSpecs = parseKeyframes(params["frames"])

    runOnMain { [weak self] in
      guard let self, let runtime = self.runtime else { return }
      guard let node = runtime.uiManager.rune_node(forId: NSNumber(value: nodeId)) else { return }
      let view = node.view

      let resolvedFrames: [RuneResolvedKeyframe]? = {
        guard !frameSpecs.isEmpty else { return nil }
        return frameSpecs
          .map { frame in
            RuneResolvedKeyframe(
              at: CGFloat(min(1.0, max(0.0, frame.at))),
              style: self.resolveStyle(from: frame.style, to: nil, view: view),
              easing: frame.easing
            )
          }
          .sorted { $0.at < $1.at }
      }()
      let resolvedFrom = resolvedFrames?.first?.style
        ?? self.resolveStyle(from: fromStyle, to: toStyle, view: view)
      let resolvedTo = resolvedFrames?.last?.style
        ?? self.resolveStyle(from: toStyle, to: fromStyle, view: view)

      let startTime = CACurrentMediaTime() + (delayMs / 1000.0)
      let animation = RuneStyleAnimation(
        nodeId: nodeId,
        animationId: animationId,
        phase: phase,
        from: resolvedFrom,
        to: resolvedTo,
        frames: resolvedFrames,
        startTime: startTime,
        duration: max(durationMs / 1000.0, 0.0),
        easing: easing
      )

      self.animations[nodeId] = animation
      self.applyStyle(resolvedFrom, to: view)
      if durationMs <= 0 {
        self.finishAnimation(animation)
      } else {
        self.ensureDisplayLink()
      }
    }

    return successResponse()
  }

  private func handleStopTransition(_ args: Any?) -> [String: Any] {
    guard let params = getDict(args) else {
      return errorResponse("invalid_argument", "params")
    }

    guard let nodeId = getInt(params["nodeId"]) else {
      return errorResponse("invalid_argument", "nodeId")
    }

    runOnMain { [weak self] in
      guard let self else { return }
      self.animations.removeValue(forKey: nodeId)
      self.stopDisplayLinkIfNeeded()
    }

    return successResponse()
  }

  private func ensureDisplayLink() {
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(step))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopDisplayLinkIfNeeded() {
    if animations.isEmpty {
      displayLink?.invalidate()
      displayLink = nil
    }
  }

  @objc private func step(link: CADisplayLink) {
    let now = link.timestamp
    let items = Array(animations.values)

    for animation in items {
      if now < animation.startTime { continue }
      let elapsed = now - animation.startTime
      let duration = max(animation.duration, 0.0001)
      let progress = min(elapsed / duration, 1.0)
      let eased = animation.easing.apply(progress)

      guard let runtime = runtime,
            let node = runtime.uiManager.rune_node(forId: NSNumber(value: animation.nodeId)) else {
        animations.removeValue(forKey: animation.nodeId)
        continue
      }

      if let frames = animation.frames, !frames.isEmpty {
        let interpolated = resolveKeyframe(frames: frames, progress: CGFloat(progress))
        applyStyle(interpolated, to: node.view)
      } else {
        let interpolated = interpolate(from: animation.from, to: animation.to, progress: eased)
        applyStyle(interpolated, to: node.view)
      }

      if progress >= 1.0 {
        finishAnimation(animation)
      }
    }

    stopDisplayLinkIfNeeded()
  }

  private func finishAnimation(_ animation: RuneStyleAnimation) {
    animations.removeValue(forKey: animation.nodeId)
    if let runtime = runtime,
      let node = runtime.uiManager.rune_node(forId: NSNumber(value: animation.nodeId)) {
      applyStyle(animation.to, to: node.view)
    }
    if let runtime = runtime {
      runtime.emitEvent(
        name: "RuneAnimate:transitionEnd",
        payload: [
          "nodeId": animation.nodeId,
          "animationId": animation.animationId,
          "phase": animation.phase
        ]
      )
    }
    stopDisplayLinkIfNeeded()
  }

  private func applyStyle(_ style: RuneResolvedStyle, to view: UIView) {
    view.alpha = style.opacity
    var transform = CGAffineTransform.identity
    transform = transform.translatedBy(x: style.translateX, y: style.translateY)
    transform = transform.rotated(by: style.rotate)
    transform = transform.scaledBy(x: style.scaleX, y: style.scaleY)
    view.transform = transform
  }

  private func interpolate(
    from: RuneResolvedStyle,
    to: RuneResolvedStyle,
    progress: Double
  ) -> RuneResolvedStyle {
    let t = CGFloat(max(0.0, min(1.0, progress)))
    return RuneResolvedStyle(
      opacity: from.opacity + (to.opacity - from.opacity) * t,
      translateX: from.translateX + (to.translateX - from.translateX) * t,
      translateY: from.translateY + (to.translateY - from.translateY) * t,
      scaleX: from.scaleX + (to.scaleX - from.scaleX) * t,
      scaleY: from.scaleY + (to.scaleY - from.scaleY) * t,
      rotate: from.rotate + (to.rotate - from.rotate) * t
    )
  }

  private func resolveKeyframe(
    frames: [RuneResolvedKeyframe],
    progress: CGFloat
  ) -> RuneResolvedStyle {
    let clamped = max(0.0, min(1.0, progress))
    guard let first = frames.first, let last = frames.last else {
      return RuneResolvedStyle(opacity: 1, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotate: 0)
    }
    if clamped <= first.at {
      return first.style
    }
    if clamped >= last.at {
      return last.style
    }
    for index in 1..<frames.count {
      let current = frames[index]
      if clamped <= current.at {
        let prev = frames[index - 1]
        let span = max(current.at - prev.at, 0.0001)
        let segmentProgress = (clamped - prev.at) / span
        let easing = current.easing ?? .linear
        let eased = easing.apply(Double(segmentProgress))
        return interpolate(from: prev.style, to: current.style, progress: eased)
      }
    }
    return last.style
  }

  private func resolveStyle(
    from: RuneAnimatedStyle?,
    to: RuneAnimatedStyle?,
    view: UIView
  ) -> RuneResolvedStyle {
    let base = decomposeTransform(view.transform)
    let opacity = resolveValue(from?.opacity, to?.opacity, view.alpha)
    let translateX = resolveValue(from?.translateX, to?.translateX, base.translateX)
    let translateY = resolveValue(from?.translateY, to?.translateY, base.translateY)
    let scaleX = resolveValue(from?.scaleX ?? from?.scale, to?.scaleX ?? to?.scale, base.scaleX)
    let scaleY = resolveValue(from?.scaleY ?? from?.scale, to?.scaleY ?? to?.scale, base.scaleY)
    let rotate = resolveValue(from?.rotate, to?.rotate, base.rotation)

    return RuneResolvedStyle(
      opacity: opacity,
      translateX: translateX,
      translateY: translateY,
      scaleX: scaleX,
      scaleY: scaleY,
      rotate: rotate
    )
  }

  private func resolveValue(_ primary: CGFloat?, _ secondary: CGFloat?, _ fallback: CGFloat) -> CGFloat {
    return primary ?? secondary ?? fallback
  }

  private func decomposeTransform(_ transform: CGAffineTransform) -> (translateX: CGFloat, translateY: CGFloat, scaleX: CGFloat, scaleY: CGFloat, rotation: CGFloat) {
    let tx = transform.tx
    let ty = transform.ty
    let scaleX = sqrt(transform.a * transform.a + transform.c * transform.c)
    let scaleY = sqrt(transform.b * transform.b + transform.d * transform.d)
    let rotation = atan2(transform.b, transform.a)
    return (tx, ty, scaleX, scaleY, rotation)
  }

  private func parseStyle(_ value: Any?) -> RuneAnimatedStyle? {
    guard let dict = value as? [String: Any] ?? (value as? NSDictionary as? [String: Any]) else {
      return nil
    }

    var style = RuneAnimatedStyle()
    if let opacity = getDouble(dict["opacity"]) {
      style.opacity = CGFloat(opacity)
    }

    if let transforms = dict["transform"] as? [Any] {
      for entry in transforms {
        guard let item = entry as? [String: Any] ?? (entry as? NSDictionary as? [String: Any]) else { continue }
        for (key, rawValue) in item {
          switch key {
          case "translateX":
            if let num = getDouble(rawValue) { style.translateX = CGFloat(num) }
          case "translateY":
            if let num = getDouble(rawValue) { style.translateY = CGFloat(num) }
          case "scale":
            if let num = getDouble(rawValue) { style.scale = CGFloat(num) }
          case "scaleX":
            if let num = getDouble(rawValue) { style.scaleX = CGFloat(num) }
          case "scaleY":
            if let num = getDouble(rawValue) { style.scaleY = CGFloat(num) }
          case "rotate", "rotateZ":
            if let radians = parseAngle(rawValue) { style.rotate = radians }
          default:
            continue
          }
        }
      }
    }

    return style
  }

  private struct RuneKeyframeSpec {
    let at: Double
    let style: RuneAnimatedStyle?
    let easing: RuneAnimateEasing?
  }

  private func parseKeyframes(_ value: Any?) -> [RuneKeyframeSpec] {
    let list: [Any]
    if let array = value as? [Any] {
      list = array
    } else if let array = value as? NSArray {
      list = array.compactMap { $0 }
    } else {
      return []
    }
    if list.isEmpty { return [] }
    var frames: [RuneKeyframeSpec] = []
    for entry in list {
      let item = entry as? [String: Any] ?? (entry as? NSDictionary as? [String: Any])
      guard let dict = item else { continue }
      guard let at = getDouble(dict["at"]) else { continue }
      let style = parseStyle(dict["style"])
      let easingName = dict["easing"] as? String
      let easing = easingName.flatMap { RuneAnimateEasing(rawValue: $0) }
      frames.append(RuneKeyframeSpec(at: at, style: style, easing: easing))
    }
    return frames
  }

  private func parseAngle(_ value: Any?) -> CGFloat? {
    if let number = getDouble(value) {
      return CGFloat(number * Double.pi / 180.0)
    }
    guard let string = value as? String else { return nil }
    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasSuffix("deg") {
      let raw = trimmed.replacingOccurrences(of: "deg", with: "")
      if let degrees = Double(raw) {
        return CGFloat(degrees * Double.pi / 180.0)
      }
    }
    if trimmed.hasSuffix("rad") {
      let raw = trimmed.replacingOccurrences(of: "rad", with: "")
      if let radians = Double(raw) {
        return CGFloat(radians)
      }
    }
    return nil
  }

  private func getDict(_ args: Any?) -> [String: Any]? {
    if let dict = args as? [String: Any] { return dict }
    if let dict = args as? NSDictionary { return dict as? [String: Any] }
    return nil
  }

  private func getInt(_ value: Any?) -> Int? {
    if let number = value as? NSNumber { return number.intValue }
    if let string = value as? String, let parsed = Int(string) { return parsed }
    return nil
  }

  private func getDouble(_ value: Any?) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    if let string = value as? String, let parsed = Double(string) { return parsed }
    return nil
  }

  private func runOnMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async { block() }
    }
  }

  private func successResponse() -> [String: Any] {
    return ["success": true]
  }

  private func errorResponse(_ error: String, _ message: String) -> [String: Any] {
    return ["error": error, "message": message]
  }
}
