import Foundation
import UIKit
import ZynthKit

@objc(ZynthSkiaView)
@objcMembers
public final class ZynthSkiaView: UIView, ZynthInspectableComponent {
  private weak var manager: ZynthUIManager?
  private weak var node: ZynthNode?

  private var clearColorValue: UIColor = .clear
  private var commands: [SkiaCommand] = []
  private var displayLink: CADisplayLink?
  private var frameLoopEnabled = false

  func bind(manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
    ZynthSkiaViewRegistry.shared.register(nodeId: Int(node.nid), view: self)
  }

  func markSurfaceReady() {
    emit("onNativeReady", payload: ["available": true])
  }

  func resetSurface() {
    setFrameLoopEnabled(false)
    clearColorValue = .clear
    commands.removeAll(keepingCapacity: false)
    setNeedsDisplay()
  }

  func invalidateSurface() {
    setNeedsDisplay()
  }

  func setFrameLoopEnabled(_ enabled: Bool) {
    frameLoopEnabled = enabled
    if enabled {
      ensureDisplayLink()
    } else {
      stopDisplayLink()
    }
  }

  func setClearColor(_ raw: String?) {
    clearColorValue = parseColor(raw) ?? clearColorValue
    setNeedsDisplay()
  }

  func submitCommands(_ rawCommands: [[String: Any]]) {
    commands = rawCommands.compactMap(SkiaCommand.from(raw:))
    setNeedsDisplay()
  }

  func submitFrame(_ rawFrame: [String: Any]?) {
    guard let rawFrame else { return }
    if let rawClear = rawFrame["clear"] as? String, let next = parseColor(rawClear) {
      clearColorValue = next
    }
    let rawCommands = rawFrame["commands"] as? [[String: Any]] ?? []
    commands = rawCommands.compactMap(SkiaCommand.from(raw:))
    setNeedsDisplay()
  }

  public override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    context.setFillColor(clearColorValue.cgColor)
    context.fill(bounds)

    for command in commands {
      switch command {
      case let .clear(color):
        context.setFillColor(color.cgColor)
        context.fill(bounds)
      case let .rect(x, y, width, height, color, style, strokeWidth):
        let frame = CGRect(x: x, y: y, width: width, height: height)
        switch style {
        case .fill:
          context.setFillColor(color.cgColor)
          context.fill(frame)
        case .stroke:
          context.setStrokeColor(color.cgColor)
          context.setLineWidth(strokeWidth)
          context.stroke(frame)
        }
      case let .circle(cx, cy, r, color, style, strokeWidth):
        let frame = CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)
        switch style {
        case .fill:
          context.setFillColor(color.cgColor)
          context.fillEllipse(in: frame)
        case .stroke:
          context.setStrokeColor(color.cgColor)
          context.setLineWidth(strokeWidth)
          context.strokeEllipse(in: frame)
        }
      case let .line(x1, y1, x2, y2, color, strokeWidth):
        context.beginPath()
        context.move(to: CGPoint(x: x1, y: y1))
        context.addLine(to: CGPoint(x: x2, y: y2))
        context.setStrokeColor(color.cgColor)
        context.setLineWidth(strokeWidth)
        context.strokePath()
      }
    }
  }

  public func zynthInspectState() -> [AnyHashable: Any] {
    [
      "nodeId": node?.nid ?? -1,
      "frameLoopEnabled": frameLoopEnabled,
      "commandCount": commands.count,
    ]
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      setFrameLoopEnabled(false)
      if let nodeId = node?.nid {
        ZynthSkiaViewRegistry.shared.unregister(nodeId: Int(nodeId))
      }
    }
  }

  private func ensureDisplayLink() {
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(onFrame))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopDisplayLink() {
    displayLink?.invalidate()
    displayLink = nil
  }

  @objc private func onFrame() {
    guard frameLoopEnabled else { return }
    setNeedsDisplay()
  }

  private func emit(_ name: String, payload: [String: Any]) {
    guard let manager, let node else { return }
    manager.zynth_dispatchEvent(name, payload: payload as [AnyHashable: Any], to: node)
  }

  private func parseColor(_ raw: String?) -> UIColor? {
    guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
      return nil
    }
    if value == "transparent" {
      return .clear
    }
    if value.hasPrefix("#") {
      value.removeFirst()
      if value.count == 6 {
        value = "FF" + value
      }
      guard value.count == 8, let hex = UInt64(value, radix: 16) else {
        return nil
      }
      let a = CGFloat((hex >> 24) & 0xFF) / 255.0
      let r = CGFloat((hex >> 16) & 0xFF) / 255.0
      let g = CGFloat((hex >> 8) & 0xFF) / 255.0
      let b = CGFloat(hex & 0xFF) / 255.0
      return UIColor(red: r, green: g, blue: b, alpha: a)
    }
    return nil
  }
}

private enum DrawStyle {
  case fill
  case stroke
}

private enum SkiaCommand {
  case clear(color: UIColor)
  case rect(
    x: CGFloat,
    y: CGFloat,
    width: CGFloat,
    height: CGFloat,
    color: UIColor,
    style: DrawStyle,
    strokeWidth: CGFloat
  )
  case circle(
    cx: CGFloat,
    cy: CGFloat,
    r: CGFloat,
    color: UIColor,
    style: DrawStyle,
    strokeWidth: CGFloat
  )
  case line(
    x1: CGFloat,
    y1: CGFloat,
    x2: CGFloat,
    y2: CGFloat,
    color: UIColor,
    strokeWidth: CGFloat
  )

  static func from(raw: [String: Any]) -> SkiaCommand? {
    guard let type = raw["type"] as? String else { return nil }
    switch type {
    case "clear":
      guard let color = parseColor(raw["color"] as? String) else { return nil }
      return .clear(color: color)
    case "rect":
      guard
        let color = parseColor(raw["color"] as? String),
        let x = number(raw["x"]),
        let y = number(raw["y"]),
        let width = number(raw["width"]),
        let height = number(raw["height"])
      else { return nil }
      let strokeWidth = number(raw["strokeWidth"]) ?? 1
      let style = parseStyle(raw["style"] as? String)
      return .rect(
        x: x,
        y: y,
        width: width,
        height: height,
        color: color,
        style: style,
        strokeWidth: strokeWidth
      )
    case "circle":
      guard
        let color = parseColor(raw["color"] as? String),
        let cx = number(raw["cx"]),
        let cy = number(raw["cy"]),
        let r = number(raw["r"])
      else { return nil }
      let strokeWidth = number(raw["strokeWidth"]) ?? 1
      let style = parseStyle(raw["style"] as? String)
      return .circle(
        cx: cx,
        cy: cy,
        r: r,
        color: color,
        style: style,
        strokeWidth: strokeWidth
      )
    case "line":
      guard
        let color = parseColor(raw["color"] as? String),
        let x1 = number(raw["x1"]),
        let y1 = number(raw["y1"]),
        let x2 = number(raw["x2"]),
        let y2 = number(raw["y2"])
      else { return nil }
      let strokeWidth = number(raw["strokeWidth"]) ?? 1
      return .line(
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2,
        color: color,
        strokeWidth: strokeWidth
      )
    default:
      return nil
    }
  }

  private static func number(_ raw: Any?) -> CGFloat? {
    switch raw {
    case let value as NSNumber:
      return CGFloat(value.doubleValue)
    case let value as Double:
      return CGFloat(value)
    case let value as Float:
      return CGFloat(value)
    case let value as Int:
      return CGFloat(value)
    default:
      return nil
    }
  }

  private static func parseStyle(_ raw: String?) -> DrawStyle {
    return raw?.lowercased() == "stroke" ? .stroke : .fill
  }

  private static func parseColor(_ raw: String?) -> UIColor? {
    guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
      return nil
    }
    if value == "transparent" {
      return .clear
    }
    if value.hasPrefix("#") {
      value.removeFirst()
      if value.count == 6 {
        value = "FF" + value
      }
      guard value.count == 8, let hex = UInt64(value, radix: 16) else {
        return nil
      }
      let a = CGFloat((hex >> 24) & 0xFF) / 255.0
      let r = CGFloat((hex >> 16) & 0xFF) / 255.0
      let g = CGFloat((hex >> 8) & 0xFF) / 255.0
      let b = CGFloat(hex & 0xFF) / 255.0
      return UIColor(red: r, green: g, blue: b, alpha: a)
    }
    return nil
  }
}
