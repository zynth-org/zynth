import Foundation
import UIKit
import ZynthKit

@objc(ZynthSkiaView)
@objcMembers
public final class ZynthSkiaView: UIView {
  private weak var manager: ZynthUIManager?
  private weak var node: ZynthNode?

  private var clearColorValue: UIColor = .clear
  private var frameLoopEnabled: Bool = false
  private var allowFallback: Bool = true
  private var surfaceAvailable: Bool = false

  public override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    isOpaque = false
    backgroundColor = .clear
  }

  func bindWithManager(_ manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
  }

  func setClearColorValue(_ value: String?) {
    clearColorValue = parseColor(value)
    setNeedsDisplay()
  }

  func setFrameLoopEnabledValue(_ enabled: Bool) {
    frameLoopEnabled = enabled
  }

  func setAllowFallbackValue(_ allow: Bool) {
    allowFallback = allow
  }

  func setSurfaceAvailable(_ available: Bool) {
    surfaceAvailable = available
    setNeedsDisplay()
  }

  func markSurfaceDirty() {
    setNeedsDisplay()
  }

  public override func draw(_ rect: CGRect) {
    super.draw(rect)
    guard surfaceAvailable, let node else { return }
    let width = Int(bounds.width.rounded(.down))
    let height = Int(bounds.height.rounded(.down))
    guard width > 0, height > 0 else { return }

    let clear = clearColorValue.toARGB32()
    guard let image = ZynthSkiaRendererBridge.renderImage(forNode: Int(node.nid),
                                                          width: width,
                                                          height: height,
                                                          clearColor: clear) else {
      return
    }
    image.draw(in: bounds)
  }

  func emitNativeReady() {
    guard let manager, let node else { return }
    manager.zynth_dispatchEvent(
      "onNativeReady",
      payload: ["available": surfaceAvailable],
      to: node
    )
  }

  func cleanup() {
    surfaceAvailable = false
    frameLoopEnabled = false
    clearColorValue = .clear
    setNeedsDisplay()
  }

  private func parseColor(_ value: String?) -> UIColor {
    guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !raw.isEmpty,
          raw != "null" else {
      return .clear
    }

    if raw.hasPrefix("#") {
      let hex = String(raw.dropFirst())
      if hex.count == 6, let rgb = UInt32(hex, radix: 16) {
        let r = CGFloat((rgb >> 16) & 0xff) / 255.0
        let g = CGFloat((rgb >> 8) & 0xff) / 255.0
        let b = CGFloat(rgb & 0xff) / 255.0
        return UIColor(red: r, green: g, blue: b, alpha: 1.0)
      }
      if hex.count == 8, let argb = UInt32(hex, radix: 16) {
        let a = CGFloat((argb >> 24) & 0xff) / 255.0
        let r = CGFloat((argb >> 16) & 0xff) / 255.0
        let g = CGFloat((argb >> 8) & 0xff) / 255.0
        let b = CGFloat(argb & 0xff) / 255.0
        return UIColor(red: r, green: g, blue: b, alpha: a)
      }
    }

    return .clear
  }
}

private extension UIColor {
  func toARGB32() -> UInt32 {
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    guard getRed(&r, green: &g, blue: &b, alpha: &a) else {
      return 0
    }
    let ai = UInt32((a * 255).rounded())
    let ri = UInt32((r * 255).rounded())
    let gi = UInt32((g * 255).rounded())
    let bi = UInt32((b * 255).rounded())
    return (ai << 24) | (ri << 16) | (gi << 8) | bi
  }
}
