import RuneKit
import UIKit

@available(iOS 16.0, *)
@objcMembers
public final class RuneBottomSheetView: UIView {
  private let contentHost: UIView = {
    let view = UIView()
    view.isHidden = false
    view.backgroundColor = .clear
    return view
  }()

  private lazy var presenter = RuneBottomSheetPresenter(contentHost: contentHost, host: self)
  private var manager: SNUIManager?
  private var node: SNNode?
  private var options = RuneBottomSheetOptions()

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

  @objc public func bind(manager: SNUIManager, node: SNNode) {
    self.manager = manager
    self.node = node
  }

  @objc public func reset() {
    presenter.reset()
    manager = nil
    node = nil
    options = RuneBottomSheetOptions()
    presenter.updateOptions(options)
  }

  func dispatchEvent(_ name: String, payload: [AnyHashable: Any]?) {
    guard let manager = manager, let node = node else { return }
    let selector = NSSelectorFromString("rune_dispatchEvent:payload:toNode:")
    guard let method = manager.method(for: selector) else { return }
    typealias Imp = @convention(c) (AnyObject, Selector, NSString, NSDictionary?, SNNode) -> Void
    let function = unsafeBitCast(method, to: Imp.self)
    function(manager, selector, name as NSString, payload as NSDictionary?, node)
  }

  @objc public func updateSnapPoints(_ items: NSArray?) {

    let parsed = BottomSheetSnapPoint.parseList(items)
    options.snapPoints = parsed.isEmpty ? RuneBottomSheetOptions.defaultSnapPoints : parsed
    presenter.updateOptions(options)
  }

  @objc public func setOverlayColorString(_ color: NSString?) {

    if let parsed = BottomSheetColorParser.color(from: color as String?) {
      options.overlayColor = parsed
      presenter.updateOptions(options)
    }
  }

  @objc public func setOverlayOpacityValue(_ value: NSNumber?) {

    guard let value = value else { return }
    options.overlayOpacity = CGFloat(value.floatValue).clamped(to: 0...1)
    presenter.updateOptions(options)
  }

  @objc public func setDismissOnOverlayPress(_ value: NSNumber?) {

    guard let value = value else { return }
    options.dismissOnOverlayPress = value.boolValue
    presenter.updateOptions(options)
  }

  @objc public func setAllowDismissOnInteraction(_ value: NSNumber?) {

    guard let value = value else { return }
    options.allowDismissOnInteraction = value.boolValue
    presenter.updateOptions(options)
  }

  @objc public func setInitialSnapIndex(_ value: NSNumber?) {

    guard let value = value else { return }
    options.initialSnapIndex = max(0, value.intValue)
    presenter.updateOptions(options)
  }

  @objc public func setOpenState(_ value: NSNumber?) {

    guard let value = value else { return }
    presenter.setOpenState(value.boolValue, preferredIndex: options.initialSnapIndex)
  }

  @objc public func handleCommand(_ command: NSDictionary?) {
    guard let command = command as? [String: Any], let type = command["type"] as? String else {
      return
    }

    switch type {
    case "open":
      let index = (command["index"] as? NSNumber)?.intValue
      presenter.present(index: index ?? options.initialSnapIndex)
    case "close":
      presenter.dismiss()
    case "snapTo":
      if let index = (command["index"] as? NSNumber)?.intValue {
        presenter.snapTo(index: index)
      }
    default:
      break
    }
  }
}
