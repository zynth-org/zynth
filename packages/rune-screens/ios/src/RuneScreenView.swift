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
  var rightButton: RuneScreenHeaderButtonOptions?
  var rightAccessory: RuneScreenHeaderAccessory?

  static let `default` = RuneScreenHeaderOptions(
    title: nil,
    subtitle: nil,
    prefersLargeTitle: false,
    isVisible: true,
    isBackVisible: true,
    isTransparent: false,
    tintColor: nil,
    titleColor: nil,
    backgroundColor: nil,
    rightButton: nil,
    rightAccessory: nil
  )
}

struct RuneScreenHeaderButtonOptions: Equatable {
  var title: String?
  var style: String?
  var systemItem: String?
}

struct RuneScreenHeaderAccessory: Equatable {
  var routeKey: String
  var position: String
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

  weak var manager: SNUIManager?
  weak var runtime: RuneRuntime?
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
    self.runtime = RuneRuntimeManagerRegistry.shared.runtime(for: manager)
    self.node = node
  }

  public func prepareForReuse() {
    manager = nil
    runtime = nil
    node = nil
    pendingActiveState = nil
    isScreenActive = false
    container = nil
  }

  public func setScreenKeyValue(_ value: NSString?) {
    screenKey = value as String? ?? ""
  }

  public func setAnimationTypeString(_ value: NSString?) {
    let newType = RuneScreenAnimation(string: value as String?)
    guard animationType != newType else { return }
    animationType = newType
    container?.screenAnimationDidChange(self)
  }

  public func setGestureEnabledValue(_ value: NSNumber?) {
    let newValue = value?.boolValue ?? true
    guard gestureEnabled != newValue else { return }
    gestureEnabled = newValue
    container?.refreshInteractiveGestureState()
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
      if let rightButton = dict["rightButton"] as? [String: Any] {
        var buttonOptions = RuneScreenHeaderButtonOptions()
        if let title = rightButton["title"] as? String {
          buttonOptions.title = title
        }
        if let style = rightButton["style"] as? String {
          buttonOptions.style = style
        }
        if let systemItem = rightButton["systemItem"] as? String {
          buttonOptions.systemItem = systemItem
        }
        options.rightButton = buttonOptions
      } else {
        options.rightButton = nil
      }
      if
        let accessory = dict["rightAccessory"] as? [String: Any],
        let type = accessory["type"] as? String,
        type == "surface",
        let routeKey = accessory["routeKey"] as? String,
        let position = accessory["position"] as? String
      {
        options.rightAccessory = RuneScreenHeaderAccessory(routeKey: routeKey, position: position)
      } else {
        options.rightAccessory = nil
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

  func notifyNativeHeaderRightPress() {
    dispatchEvent(name: "onNativeHeaderRightPress")
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
