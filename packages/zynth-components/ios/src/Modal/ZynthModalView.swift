import ZynthKit
import UIKit

@objcMembers
public final class ZynthModalView: UIView {
  private weak var manager: ZynthUIManager?
  private weak var node: ZynthNode?

  private let contentHost: UIView = {
    let view = ZynthModalPassthroughView()
    view.isHidden = false
    view.backgroundColor = .clear
    return view
  }()

  private lazy var presenter = ZynthModalPresenter(contentHost: contentHost, host: self)
  private var options = ZynthModalOptions()

  public override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    isHidden = true
    super.addSubview(contentHost)
    contentHost.frame = bounds
    contentHost.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    presenter.updateOptions(options)
  }

  public override func addSubview(_ view: UIView) {
    if view === contentHost {
      super.addSubview(view)
      return
    }
    insertSubview(view, at: contentHost.subviews.count)
  }

  public override func insertSubview(_ view: UIView, at index: Int) {
    if view === contentHost {
      super.insertSubview(view, at: index)
      return
    }
    contentHost.insertSubview(view, at: index)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    contentHost.frame = bounds
  }

  public func bind(manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
  }

  public func reset() {
    presenter.reset()
    manager = nil
    node = nil
    options = ZynthModalOptions()
    presenter.updateOptions(options)
  }

  public func setOpenState(_ value: NSNumber?) {
    guard let value else { return }
    presenter.setOpenState(value.boolValue)
  }

  public func setAnimationStyle(_ value: String?) {
    options.animation = ZynthModalAnimation.from(value)
    presenter.updateOptions(options)
  }

  public func setTransparent(_ value: NSNumber?) {
    guard let value else { return }
    options.transparent = value.boolValue
    presenter.updateOptions(options)
  }

  public func setOverlayColor(_ value: UIColor?) {
    if let value {
      options.overlayColor = value
      presenter.updateOptions(options)
    }
  }

  public func setOverlayOpacity(_ value: NSNumber?) {
    guard let value else { return }
    options.overlayOpacity = CGFloat(value.floatValue).clamped(to: 0...1)
    presenter.updateOptions(options)
  }

  public func setDismissOnOverlayPress(_ value: NSNumber?) {
    guard let value else { return }
    options.dismissOnOverlayPress = value.boolValue
    presenter.updateOptions(options)
  }

  public func handleCommand(_ command: NSDictionary?) {
    guard let command = command as? [String: Any], let type = command["type"] as? String else {
      return
    }

    switch type {
    case "show":
      presenter.present()
    case "dismiss":
      presenter.dismiss()
    default:
      break
    }
  }

  func dispatchEvent(_ name: String, payload: [AnyHashable: Any]?) {
    guard let manager = manager, let node = node else { return }
    let selector = NSSelectorFromString("zynth_dispatchEvent:payload:toNode:")
    guard let method = manager.method(for: selector) else { return }
    typealias Imp = @convention(c) (AnyObject, Selector, NSString, NSDictionary?, ZynthNode) -> Void
    let function = unsafeBitCast(method, to: Imp.self)
    function(manager, selector, name as NSString, payload as NSDictionary?, node)
  }
}

private extension CGFloat {
  func clamped(to range: ClosedRange<CGFloat>) -> CGFloat {
    return Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
  }
}

private final class ZynthModalPassthroughView: UIView {
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    for subview in subviews.reversed() {
      if subview.isHidden || subview.alpha == 0 || !subview.isUserInteractionEnabled {
        continue
      }
      let converted = convert(point, to: subview)
      if subview.hitTest(converted, with: event) != nil {
        return true
      }
    }
    return false
  }
}
