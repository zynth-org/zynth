import Foundation
import UIKit
import ZynthKit

@_silgen_name("ZynthSkiaRasterCreateFrame")
private func ZynthSkiaRasterCreateFrame(
  _ width: Int32,
  _ height: Int32,
  _ pixels: UnsafeMutableRawPointer?,
  _ rowBytes: Int,
) -> UnsafeMutableRawPointer?

@_silgen_name("ZynthSkiaRasterDestroyFrame")
private func ZynthSkiaRasterDestroyFrame(_ frame: UnsafeMutableRawPointer?)

@_silgen_name("ZynthSkiaRasterClear")
private func ZynthSkiaRasterClear(_ frame: UnsafeMutableRawPointer?, _ argb: UInt32)

@_silgen_name("ZynthSkiaRasterDrawRect")
private func ZynthSkiaRasterDrawRect(
  _ frame: UnsafeMutableRawPointer?,
  _ x: Float,
  _ y: Float,
  _ width: Float,
  _ height: Float,
  _ argb: UInt32,
  _ stroke: Bool,
  _ strokeWidth: Float,
)

@_silgen_name("ZynthSkiaRasterDrawCircle")
private func ZynthSkiaRasterDrawCircle(
  _ frame: UnsafeMutableRawPointer?,
  _ cx: Float,
  _ cy: Float,
  _ radius: Float,
  _ argb: UInt32,
  _ stroke: Bool,
  _ strokeWidth: Float,
)

@_silgen_name("ZynthSkiaRasterDrawLine")
private func ZynthSkiaRasterDrawLine(
  _ frame: UnsafeMutableRawPointer?,
  _ x1: Float,
  _ y1: Float,
  _ x2: Float,
  _ y2: Float,
  _ argb: UInt32,
  _ strokeWidth: Float,
)

@objc(ZynthSkiaView)
@objcMembers
public final class ZynthSkiaView: UIView, ZynthInspectableComponent {
  private weak var manager: ZynthUIManager?
  private weak var node: ZynthNode?

  private var clearColorValue: UIColor = .clear
  private var commands: [SkiaCommand] = []
  private var displayLink: CADisplayLink?
  private var frameLoopEnabled = false
  private var allowFallback = true
  private var didLogSkiaRenderer = false
  private var didWarnFallbackUsage = false
  private var didWarnFallbackDisabled = false

  func bind(manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
    ZynthSkiaViewRegistry.shared.register(nodeId: Int(node.nid), view: self)
  }

  func markSurfaceReady() {
    runOnMain { [weak self] in
      self?.emit("onNativeReady", payload: ["available": true])
    }
  }

  func resetSurface() {
    runOnMain { [weak self] in
      guard let self else { return }
      self.setFrameLoopEnabled(false)
      self.clearColorValue = .clear
      self.commands.removeAll(keepingCapacity: false)
      self.setNeedsDisplay()
    }
  }

  func invalidateSurface() {
    runOnMain { [weak self] in
      self?.setNeedsDisplay()
    }
  }

  func setFrameLoopEnabled(_ enabled: Bool) {
    runOnMain { [weak self] in
      guard let self else { return }
      self.frameLoopEnabled = enabled
      if enabled {
        self.ensureDisplayLink()
      } else {
        self.stopDisplayLink()
      }
    }
  }

  func setAllowFallback(_ enabled: Bool) {
    runOnMain { [weak self] in
      guard let self else { return }
      self.allowFallback = enabled
      self.setNeedsDisplay()
    }
  }

  func setClearColor(_ raw: String?) {
    runOnMain { [weak self] in
      guard let self else { return }
      self.clearColorValue = self.parseColor(raw) ?? self.clearColorValue
      self.setNeedsDisplay()
    }
  }

  func submitCommands(_ rawCommands: [[String: Any]]) {
    runOnMain { [weak self] in
      guard let self else { return }
      self.commands = rawCommands.compactMap(SkiaCommand.from(raw:))
      self.setNeedsDisplay()
    }
  }

  func submitPackedCommands(_ opsData: Data, opCount: Int, stringTable: [String]) {
    runOnMain { [weak self] in
      guard let self else { return }
      self.commands = SkiaCommand.fromPacked(data: opsData, opCount: opCount, stringTable: stringTable)
      self.setNeedsDisplay()
    }
  }

  func submitFrame(_ rawFrame: [String: Any]?) {
    runOnMain { [weak self] in
      guard let self, let rawFrame else { return }
      if let rawClear = rawFrame["clear"] as? String, let next = self.parseColor(rawClear) {
        self.clearColorValue = next
      }
      let rawCommands = rawFrame["commands"] as? [[String: Any]] ?? []
      self.commands = rawCommands.compactMap(SkiaCommand.from(raw:))
      self.setNeedsDisplay()
    }
  }

  public override func draw(_ rect: CGRect) {
    if drawWithSkia() {
      if !didLogSkiaRenderer {
        didLogSkiaRenderer = true
        print("[ZynthSkia] Using Skia renderer.")
      }
      return
    }
    if !allowFallback {
      if !didWarnFallbackDisabled {
        didWarnFallbackDisabled = true
        print("[ZynthSkia][Warning] Skia render failed and fallback is disabled (allowFallback=false). Canvas will not use native fallback.")
      }
      guard let context = UIGraphicsGetCurrentContext() else { return }
      context.setFillColor(clearColorValue.cgColor)
      context.fill(bounds)
      return
    }
    if !didWarnFallbackUsage {
      didWarnFallbackUsage = true
      print("[ZynthSkia][Warning] Falling back to CoreGraphics renderer instead of Skia.")
    }
    guard let context = UIGraphicsGetCurrentContext() else { return }
    drawWithCoreGraphics(context)
  }

  private func drawWithSkia() -> Bool {
    let drawBounds = bounds.integral
    guard drawBounds.width > 0, drawBounds.height > 0 else { return false }

    let scale = window?.screen.scale ?? UIScreen.main.scale
    let pixelWidth = max(Int((drawBounds.width * scale).rounded(.up)), 1)
    let pixelHeight = max(Int((drawBounds.height * scale).rounded(.up)), 1)
    let rowBytes = pixelWidth * 4
    let byteCount = rowBytes * pixelHeight

    var pixelData = Data(count: byteCount)
    let rendered = pixelData.withUnsafeMutableBytes { rawBuffer -> Bool in
      guard let baseAddress = rawBuffer.baseAddress else { return false }
      guard
        let frame = ZynthSkiaRasterCreateFrame(
          Int32(pixelWidth),
          Int32(pixelHeight),
          baseAddress,
          rowBytes
        )
      else {
        return false
      }
      defer {
        ZynthSkiaRasterDestroyFrame(frame)
      }

      let drawScale = Float(scale)
      ZynthSkiaRasterClear(frame, argbColor(clearColorValue))
      for command in commands {
        switch command {
        case let .clear(color):
          ZynthSkiaRasterClear(frame, argbColor(color))
        case let .rect(x, y, width, height, color, style, strokeWidth):
          ZynthSkiaRasterDrawRect(
            frame,
            Float(x) * drawScale,
            Float(y) * drawScale,
            Float(width) * drawScale,
            Float(height) * drawScale,
            argbColor(color),
            style == .stroke,
            Float(strokeWidth) * drawScale
          )
        case let .circle(cx, cy, r, color, style, strokeWidth):
          ZynthSkiaRasterDrawCircle(
            frame,
            Float(cx) * drawScale,
            Float(cy) * drawScale,
            Float(r) * drawScale,
            argbColor(color),
            style == .stroke,
            Float(strokeWidth) * drawScale
          )
        case let .line(x1, y1, x2, y2, color, strokeWidth):
          ZynthSkiaRasterDrawLine(
            frame,
            Float(x1) * drawScale,
            Float(y1) * drawScale,
            Float(x2) * drawScale,
            Float(y2) * drawScale,
            argbColor(color),
            Float(strokeWidth) * drawScale
          )
        }
      }
      return true
    }
    guard rendered else { return false }

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    // The wrapped Skia surface writes RGBA premultiplied pixels for this build.
    // Using the wrong CG bitmap layout swaps red/blue on iOS simulator.
    let bitmapInfo = CGBitmapInfo.byteOrder32Big.union(
      CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
    )
    let dataRef = pixelData as CFData
    guard let provider = CGDataProvider(data: dataRef) else { return false }
    guard
      let image = CGImage(
        width: pixelWidth,
        height: pixelHeight,
        bitsPerComponent: 8,
        bitsPerPixel: 32,
        bytesPerRow: rowBytes,
        space: colorSpace,
        bitmapInfo: bitmapInfo,
        provider: provider,
        decode: nil,
        shouldInterpolate: true,
        intent: .defaultIntent
      )
    else { return false }

    UIImage(cgImage: image).draw(in: drawBounds)
    return true
  }

  private func drawWithCoreGraphics(_ context: CGContext) {
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

  private func argbColor(_ color: UIColor) -> UInt32 {
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    if color.getRed(&r, green: &g, blue: &b, alpha: &a) {
      return packARGB(r: r, g: g, b: b, a: a)
    }
    if let converted = color.cgColor.converted(
      to: CGColorSpaceCreateDeviceRGB(),
      intent: .defaultIntent,
      options: nil
    ), let components = converted.components {
      if components.count >= 4 {
        return packARGB(
          r: components[0],
          g: components[1],
          b: components[2],
          a: components[3]
        )
      }
      if components.count == 2 {
        return packARGB(
          r: components[0],
          g: components[0],
          b: components[0],
          a: components[1]
        )
      }
    }
    return 0
  }

  private func packARGB(r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) -> UInt32 {
    let alpha = UInt32((max(0, min(1, a)) * 255).rounded())
    let red = UInt32((max(0, min(1, r)) * 255).rounded())
    let green = UInt32((max(0, min(1, g)) * 255).rounded())
    let blue = UInt32((max(0, min(1, b)) * 255).rounded())
    return (alpha << 24) | (red << 16) | (green << 8) | blue
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

  private func runOnMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread {
      work()
      return
    }
    DispatchQueue.main.async(execute: work)
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

  static func fromPacked(data: Data, opCount: Int, stringTable: [String]) -> [SkiaCommand] {
    guard opCount >= 0 else { return [] }
    let (requiredBytes, overflow) = opCount.multipliedReportingOverflow(by: MemoryLayout<Double>.stride)
    guard !overflow else { return [] }
    guard requiredBytes <= data.count else { return [] }

    var ops = [Double](repeating: 0, count: opCount)
    ops.withUnsafeMutableBytes { destination in
      data.withUnsafeBytes { source in
        guard let src = source.baseAddress, let dst = destination.baseAddress else { return }
        memcpy(dst, src, requiredBytes)
      }
    }

    var parsed: [SkiaCommand] = []
    parsed.reserveCapacity(max(0, opCount / 2))

    var index = 0
    while index < ops.count {
      let opcode = Int(ops[index])
      index += 1
      switch opcode {
      case 1: // clear
        guard index + 2 <= ops.count else { return parsed }
        let colorType = Int(ops[index]); index += 1
        let payload = ops[index]; index += 1
        let color = readPackedColor(colorType: colorType, payload: payload, stringTable: stringTable, fallback: .clear)
        parsed.append(.clear(color: color))
      case 2: // rect
        guard index + 8 <= ops.count else { return parsed }
        let x = CGFloat(ops[index]); index += 1
        let y = CGFloat(ops[index]); index += 1
        let width = CGFloat(ops[index]); index += 1
        let height = CGFloat(ops[index]); index += 1
        let colorType = Int(ops[index]); index += 1
        let payload = ops[index]; index += 1
        let strokeWidth = CGFloat(ops[index]); index += 1
        let styleCode = Int(ops[index]); index += 1
        let color = readPackedColor(colorType: colorType, payload: payload, stringTable: stringTable, fallback: .white)
        parsed.append(
          .rect(
            x: x,
            y: y,
            width: width,
            height: height,
            color: color,
            style: styleCode == 1 ? .stroke : .fill,
            strokeWidth: strokeWidth
          )
        )
      case 3: // circle
        guard index + 7 <= ops.count else { return parsed }
        let cx = CGFloat(ops[index]); index += 1
        let cy = CGFloat(ops[index]); index += 1
        let r = CGFloat(ops[index]); index += 1
        let colorType = Int(ops[index]); index += 1
        let payload = ops[index]; index += 1
        let strokeWidth = CGFloat(ops[index]); index += 1
        let styleCode = Int(ops[index]); index += 1
        let color = readPackedColor(colorType: colorType, payload: payload, stringTable: stringTable, fallback: .white)
        parsed.append(
          .circle(
            cx: cx,
            cy: cy,
            r: r,
            color: color,
            style: styleCode == 1 ? .stroke : .fill,
            strokeWidth: strokeWidth
          )
        )
      case 4: // line
        guard index + 7 <= ops.count else { return parsed }
        let x1 = CGFloat(ops[index]); index += 1
        let y1 = CGFloat(ops[index]); index += 1
        let x2 = CGFloat(ops[index]); index += 1
        let y2 = CGFloat(ops[index]); index += 1
        let colorType = Int(ops[index]); index += 1
        let payload = ops[index]; index += 1
        let strokeWidth = CGFloat(ops[index]); index += 1
        let color = readPackedColor(colorType: colorType, payload: payload, stringTable: stringTable, fallback: .white)
        parsed.append(
          .line(
            x1: x1,
            y1: y1,
            x2: x2,
            y2: y2,
            color: color,
            strokeWidth: strokeWidth
          )
        )
      default:
        return parsed
      }
    }

    return parsed
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

  private static func readPackedColor(
    colorType: Int,
    payload: Double,
    stringTable: [String],
    fallback: UIColor
  ) -> UIColor {
    switch colorType {
    case 1:
      guard payload.isFinite else { return fallback }
      let signed = Int32(payload)
      let argb = UInt32(bitPattern: signed)
      return colorFromARGB(argb)
    case 2:
      guard payload.isFinite else { return fallback }
      let index = Int(payload)
      guard index >= 0 && index < stringTable.count else { return fallback }
      return parseColor(stringTable[index]) ?? fallback
    default:
      return fallback
    }
  }

  private static func colorFromARGB(_ argb: UInt32) -> UIColor {
    let a = CGFloat((argb >> 24) & 0xFF) / 255.0
    let r = CGFloat((argb >> 16) & 0xFF) / 255.0
    let g = CGFloat((argb >> 8) & 0xFF) / 255.0
    let b = CGFloat(argb & 0xFF) / 255.0
    return UIColor(red: r, green: g, blue: b, alpha: a)
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
