import UIKit
import ZynthKit

@objcMembers
public final class ZynthStatusBarView: UIView {
  private var statusBarStyle: UIStatusBarStyle?
  private var statusBarHidden: Bool?
  private var statusBarAnimation: UIStatusBarAnimation = .fade
  private var statusBarAnimated: Bool = false
  private var statusBarBackgroundColor: UIColor?
  private var statusBarBackgroundView: UIView?
  private var capturedInitial = false
  private var initialStyle: UIStatusBarStyle?
  private var initialHidden: Bool?

  public func setBarStyle(_ style: String?) {
    statusBarStyle = mapStyle(style)
    applyStatusBarAppearance()
  }

  public func setStatusBarHidden(_ hidden: Bool) {
    statusBarHidden = hidden
    applyStatusBarAppearance()
  }

  public func setAnimated(_ animated: Bool) {
    statusBarAnimated = animated
    applyStatusBarAppearance()
  }

  public func setShowHideTransition(_ transition: String?) {
    statusBarAnimation = mapTransition(transition)
    applyStatusBarAppearance()
  }

  public func setBackgroundColorHex(_ value: String?) {
    statusBarBackgroundColor = parseHexColor(value)
    applyStatusBarBackground()
  }

  public func reset() {
    statusBarStyle = nil
    statusBarHidden = nil
    statusBarAnimated = false
    statusBarAnimation = .fade
    statusBarBackgroundColor = nil
    ZynthStatusBarState.shared.reset()
    applyStatusBarBackground()
    applyStatusBarAppearance()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    updateBackgroundFrame()
  }

  private func applyStatusBarAppearance() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.captureInitialIfNeeded()

      let style = self.statusBarStyle ?? self.initialStyle ?? .default
      let hidden = self.statusBarHidden ?? self.initialHidden ?? false
      let animation = self.statusBarAnimated ? self.statusBarAnimation : .none

      ZynthStatusBarState.shared.update(
        style: self.statusBarStyle,
        hidden: self.statusBarHidden,
        animation: animation
      )
      UIApplication.shared.setStatusBarStyle(style, animated: self.statusBarAnimated)
      UIApplication.shared.setStatusBarHidden(hidden, with: animation)
      self.findKeyWindow()?.rootViewController?.setNeedsStatusBarAppearanceUpdate()
      self.applyStatusBarBackground()
    }
  }

  private func applyStatusBarBackground() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard let window = self.findKeyWindow() else { return }

      guard let color = self.statusBarBackgroundColor else {
        self.statusBarBackgroundView?.removeFromSuperview()
        self.statusBarBackgroundView = nil
        return
      }

      let backgroundView = self.ensureBackgroundView(in: window)
      self.updateBackgroundFrame()
      let shouldHide = self.statusBarHidden == true
      backgroundView.isHidden = shouldHide

      if self.statusBarAnimated {
        UIView.animate(withDuration: 0.25) {
          backgroundView.backgroundColor = color
        }
      } else {
        backgroundView.backgroundColor = color
      }
    }
  }

  private func ensureBackgroundView(in window: UIWindow) -> UIView {
    if let existing = statusBarBackgroundView {
      return existing
    }
    let view = UIView()
    view.isUserInteractionEnabled = false
    view.autoresizingMask = [.flexibleWidth, .flexibleBottomMargin]
    window.addSubview(view)
    statusBarBackgroundView = view
    return view
  }

  private func updateBackgroundFrame() {
    guard let window = findKeyWindow() else { return }
    guard let backgroundView = statusBarBackgroundView else { return }
    let safeTop = window.safeAreaInsets.top
    let fallback = UIApplication.shared.statusBarFrame.height
    let height = safeTop > 0 ? safeTop : fallback
    backgroundView.frame = CGRect(x: 0, y: 0, width: window.bounds.width, height: height)
  }

  private func captureInitialIfNeeded() {
    if capturedInitial { return }
    capturedInitial = true
    initialStyle = UIApplication.shared.statusBarStyle
    initialHidden = UIApplication.shared.isStatusBarHidden
  }

  private func findKeyWindow() -> UIWindow? {
    if let window = self.window {
      return window
    }
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      if let window = windowScene.windows.first(where: { $0.isKeyWindow }) {
        return window
      }
    }
    return UIApplication.shared.windows.first(where: { $0.isKeyWindow })
  }

  private func mapStyle(_ value: String?) -> UIStatusBarStyle? {
    guard let value else { return nil }
    switch value.lowercased() {
    case "light-content":
      return .lightContent
    case "dark-content":
      if #available(iOS 13.0, *) {
        return .darkContent
      }
      return .default
    case "default":
      return .default
    default:
      return nil
    }
  }

  private func mapTransition(_ value: String?) -> UIStatusBarAnimation {
    switch value?.lowercased() {
    case "slide":
      return .slide
    case "none":
      return .none
    default:
      return .fade
    }
  }

  private func parseHexColor(_ value: String?) -> UIColor? {
    guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !raw.isEmpty else {
      return nil
    }
    if raw.lowercased() == "transparent" {
      return UIColor.clear
    }
    var hex = raw
    if hex.hasPrefix("#") {
      hex.removeFirst()
    }
    if hex.count == 3 {
      let chars = Array(hex)
      hex = "\(chars[0])\(chars[0])\(chars[1])\(chars[1])\(chars[2])\(chars[2])"
    }
    guard hex.count == 6 || hex.count == 8 else { return nil }
    var valueInt: UInt64 = 0
    guard Scanner(string: hex).scanHexInt64(&valueInt) else { return nil }

    let a, r, g, b: UInt64
    if hex.count == 8 {
      a = (valueInt & 0xFF000000) >> 24
      r = (valueInt & 0x00FF0000) >> 16
      g = (valueInt & 0x0000FF00) >> 8
      b = (valueInt & 0x000000FF)
    } else {
      a = 255
      r = (valueInt & 0xFF0000) >> 16
      g = (valueInt & 0x00FF00) >> 8
      b = (valueInt & 0x0000FF)
    }
    return UIColor(
      red: CGFloat(r) / 255.0,
      green: CGFloat(g) / 255.0,
      blue: CGFloat(b) / 255.0,
      alpha: CGFloat(a) / 255.0
    )
  }
}
