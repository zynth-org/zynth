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

  private let renderQueue = DispatchQueue(label: "dev.zynth.skia.ios.render", qos: .userInteractive)
  private var displayLink: CADisplayLink?
  private var dirty: Bool = false
  private var rendering: Bool = false

  public override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    layer.isOpaque = false
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    isOpaque = false
    backgroundColor = .clear
    layer.isOpaque = false
  }

  deinit {
    stopDisplayLink()
  }

  func bindWithManager(_ manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
    ensureDisplayLink()
    updateDisplayLinkState()
  }

  func setClearColorValue(_ value: String?) {
    clearColorValue = parseColor(value)
    markSurfaceDirty()
  }

  func setFrameLoopEnabledValue(_ enabled: Bool) {
    frameLoopEnabled = enabled
    updateDisplayLinkState()
  }

  func setAllowFallbackValue(_ allow: Bool) {
    allowFallback = allow
  }

  func setSurfaceAvailable(_ available: Bool) {
    surfaceAvailable = available
    if !available {
      layer.contents = nil
    } else {
      dirty = true
    }
    updateDisplayLinkState()
  }

  func markSurfaceDirty() {
    dirty = true
    updateDisplayLinkState()
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
    dirty = false
    rendering = false
    layer.contents = nil
    updateDisplayLinkState()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    markSurfaceDirty()
  }

  @objc private func onDisplayLinkTick() {
    guard surfaceAvailable, let node else {
      updateDisplayLinkState()
      return
    }
    guard !rendering else { return }

    if !dirty && !frameLoopEnabled {
      updateDisplayLinkState()
      return
    }

    let width = Int(bounds.width.rounded(.down))
    let height = Int(bounds.height.rounded(.down))
    guard width > 0, height > 0 else {
      updateDisplayLinkState()
      return
    }

    let clear = clearColorValue.toARGB32()
    let currentNodeId = Int(node.nid)
    let scale = window?.screen.scale ?? UIScreen.main.scale

    dirty = false
    rendering = true

    renderQueue.async { [weak self] in
      guard let self else { return }
      let image = ZynthSkiaRendererBridge.renderImage(forNode: currentNodeId,
                                                      width: width,
                                                      height: height,
                                                      clearColor: clear)
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }

        defer {
          self.rendering = false
          self.updateDisplayLinkState()
        }

        guard self.surfaceAvailable,
              let liveNode = self.node,
              Int(liveNode.nid) == currentNodeId else {
          return
        }

        if let cgImage = image?.cgImage {
          self.layer.contents = cgImage
          self.layer.contentsScale = scale
          self.layer.contentsGravity = .resize
        } else if self.allowFallback {
          self.layer.contents = nil
          self.layer.backgroundColor = self.clearColorValue.cgColor
        }
      }
    }
  }

  private func ensureDisplayLink() {
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(onDisplayLinkTick))
    link.add(to: .main, forMode: .common)
    link.isPaused = true
    displayLink = link
  }

  private func stopDisplayLink() {
    displayLink?.invalidate()
    displayLink = nil
  }

  private func updateDisplayLinkState() {
    ensureDisplayLink()
    let shouldRun = surfaceAvailable && (frameLoopEnabled || dirty || rendering)
    displayLink?.isPaused = !shouldRun
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
