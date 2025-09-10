import Foundation
import RuneKit
import UIKit

struct RuneScreenHeaderOptions: Equatable {
  var title: String?
  var subtitle: String?
  var prefersLargeTitle: Bool
  var isVisible: Bool
  var isBackVisible: Bool
  var isTransparent: Bool
  var tintColor: UIColor?
  var titleColor: UIColor?
  var backgroundColor: UIColor?

  static let `default` = RuneScreenHeaderOptions(
    title: nil,
    subtitle: nil,
    prefersLargeTitle: false,
    isVisible: true,
    isBackVisible: true,
    isTransparent: false,
    tintColor: nil,
    titleColor: nil,
    backgroundColor: nil
  )
}

private extension UIColor {
  static func rune_color(from hexString: String?) -> UIColor? {
    guard var hex = hexString?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "#", with: ""),
      !hex.isEmpty
    else {
      return nil
    }

    if hex.count == 3 {
      let chars = Array(hex)
      hex = chars.map { "\($0)\($0)" }.joined()
    }

    guard hex.count == 6 || hex.count == 8 else {
      return nil
    }

    var int: UInt64 = 0
    Scanner(string: hex).scanHexInt64(&int)

    let r, g, b, a: UInt64
    if hex.count == 8 {
      a = int & 0xFF
      b = (int >> 8) & 0xFF
      g = (int >> 16) & 0xFF
      r = (int >> 24) & 0xFF
    } else {
      a = 0xFF
      b = int & 0xFF
      g = (int >> 8) & 0xFF
      r = (int >> 16) & 0xFF
    }

    return UIColor(
      red: CGFloat(r) / 255.0,
      green: CGFloat(g) / 255.0,
      blue: CGFloat(b) / 255.0,
      alpha: CGFloat(a) / 255.0
    )
  }
}

@objcMembers
public final class RuneScreenView: UIView {
  weak var container: RuneScreenContainerView? {
    didSet {
      if container !== oldValue {
        container?.screenDidAttach(self)
      }
    }
  }

  @objc public private(set) var screenKey: String = ""
  @objc public private(set) var isScreenActive: Bool = false
  @objc public private(set) var animationType: RuneScreenAnimation = .push
  @objc public private(set) var gestureEnabled: Bool = true
  var headerOptions: RuneScreenHeaderOptions = .default

  private weak var manager: SNUIManager?
  private weak var node: SNNode?

  private var pendingActiveState: Bool?

  public override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    clipsToBounds = true
    backgroundColor = .clear
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    for child in subviews {
      child.frame = bounds
    }
  }

  public func bind(manager: SNUIManager, node: SNNode) {
    self.manager = manager
    self.node = node
  }

  public func prepareForReuse() {
    manager = nil
    node = nil
    pendingActiveState = nil
    isScreenActive = false
    container = nil
  }

  public func setScreenKeyValue(_ value: NSString?) {
    screenKey = value as String? ?? ""
  }

  public func setAnimationTypeString(_ value: NSString?) {
    animationType = RuneScreenAnimation(string: value as String?)
  }

  public func setGestureEnabledValue(_ value: NSNumber?) {
    gestureEnabled = value?.boolValue ?? true
  }

  public func setActiveStateValue(_ value: NSNumber?) {
    let active = value?.boolValue ?? false
    pendingActiveState = active
    applyPendingActiveStateIfNeeded()
  }

  @objc(setHeaderOptionsFromDictionary:)
  public func setHeaderOptions(from dictionary: NSDictionary?) {
    var options = RuneScreenHeaderOptions.default
    if let dict = dictionary {
      if let title = dict["title"] as? String {
        options.title = title
      }
      if let subtitle = dict["subtitle"] as? String {
        options.subtitle = subtitle
      }
      if let prefersLargeTitle = dict["prefersLargeTitle"] as? Bool {
        options.prefersLargeTitle = prefersLargeTitle
      }
      if let visible = dict["visible"] as? Bool {
        options.isVisible = visible
      }
      if let backVisible = dict["backVisible"] as? Bool {
        options.isBackVisible = backVisible
      }
      if let transparent = dict["transparent"] as? Bool {
        options.isTransparent = transparent
      }
      if let tint = dict["tintColor"] as? String {
        options.tintColor = UIColor.rune_color(from: tint)
      }
      if let titleColor = dict["titleColor"] as? String {
        options.titleColor = UIColor.rune_color(from: titleColor)
      }
      if let backgroundColor = dict["backgroundColor"] as? String {
        options.backgroundColor = UIColor.rune_color(from: backgroundColor)
      }
    }

    if headerOptions != options {
      headerOptions = options
      container?.screenHeaderOptionsDidChange(self)
    }
  }

  private func applyPendingActiveStateIfNeeded() {
    guard let target = pendingActiveState else { return }

    if isScreenActive == target {
      pendingActiveState = nil
      return
    }

    pendingActiveState = nil
    isScreenActive = target
    container?.screenDidChangeActiveState(self)
  }

  func notifyWillAppear() {
    dispatchEvent(name: "onWillAppear")
  }

  func notifyDidAppear() {
    dispatchEvent(name: "onDidAppear")
  }

  func notifyWillDisappear() {
    dispatchEvent(name: "onWillDisappear")
  }

  func notifyDidDisappear() {
    dispatchEvent(name: "onDidDisappear")
  }

  func notifyNativeBackRequested() {
    dispatchEvent(name: "onNativeBack")
  }

  private func dispatchEvent(name: String) {
    guard let manager = manager, let node = node else { return }
    let selector = NSSelectorFromString("rune_dispatchEvent:payload:toNode:")
    guard manager.responds(to: selector), let method = manager.method(for: selector) else {
      return
    }

    typealias Imp = @convention(c) (AnyObject, Selector, NSString, NSDictionary?, SNNode) -> Void
    let function = unsafeBitCast(method, to: Imp.self)
    function(manager, selector, name as NSString, nil, node)
  }
}
