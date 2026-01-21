import UIKit

@objcMembers
public final class ZynthStatusBarState: NSObject {
  public static let shared = ZynthStatusBarState()
  public static let didChangeNotification =
    Notification.Name("ZynthStatusBarStateDidChangeNotification")

  private var capturedDefaults = false
  private var defaultStyle: UIStatusBarStyle = .default
  private var defaultHidden = false

  public private(set) var style: UIStatusBarStyle?
  public private(set) var hidden: Bool?
  public private(set) var animation: UIStatusBarAnimation = .fade

  private override init() {}

  public var resolvedStyle: UIStatusBarStyle {
    captureDefaultsIfNeeded()
    return style ?? defaultStyle
  }

  public var resolvedHidden: Bool {
    captureDefaultsIfNeeded()
    return hidden ?? defaultHidden
  }

  public func update(
    style: UIStatusBarStyle?,
    hidden: Bool?,
    animation: UIStatusBarAnimation
  ) {
    self.style = style
    self.hidden = hidden
    self.animation = animation
    NotificationCenter.default.post(name: Self.didChangeNotification, object: self)
  }

  public func reset() {
    style = nil
    hidden = nil
    animation = .fade
    NotificationCenter.default.post(name: Self.didChangeNotification, object: self)
  }

  private func captureDefaultsIfNeeded() {
    if capturedDefaults { return }
    capturedDefaults = true
    defaultStyle = UIApplication.shared.statusBarStyle
    defaultHidden = UIApplication.shared.isStatusBarHidden
  }
}
