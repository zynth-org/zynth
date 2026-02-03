import ZynthKit
import UIKit

@available(iOS 16.0, *)
@objcMembers
public final class ZynthBottomSheetView: UIView {
  private weak var manager: ZynthUIManager?
  private weak var node: ZynthNode?

  private let contentHost: UIView = {
    let view = UIView()
    view.isHidden = false
    view.backgroundColor = .clear
    return view
  }()

  private lazy var presenter = ZynthBottomSheetPresenter(contentHost: contentHost, host: self)
  private var options = ZynthBottomSheetOptions()
  private var pendingOpenState: Bool?

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

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { return }
    if let pending = pendingOpenState {
      pendingOpenState = nil
      presenter.setOpenState(pending, preferredIndex: options.initialSnapIndex)
    }
  }

  public func bind(manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
  }

  public func reset() {
    presenter.reset()
    manager = nil
    node = nil
    options = ZynthBottomSheetOptions()
    pendingOpenState = nil
    presenter.updateOptions(options)
  }

  public func updateSnapPoints(_ items: NSArray?) {
    let parsed = BottomSheetSnapPoint.parseList(items)
    options.snapPoints = parsed.isEmpty ? ZynthBottomSheetOptions().snapPoints : parsed
    presenter.updateOptions(options)
  }

  public func setInitialSnapIndex(_ value: NSNumber?) {
    guard let value else { return }
    options.initialSnapIndex = max(0, value.intValue)
    presenter.updateOptions(options)
  }

  public func setAllowBackgroundInteraction(_ value: NSNumber?) {
    guard let value else { return }
    options.allowBackgroundInteraction = value.boolValue
    presenter.updateOptions(options)
  }

  public func setAllowDismissOnInteraction(_ value: NSNumber?) {
    guard let value else { return }
    options.allowDismissOnInteraction = value.boolValue
    presenter.updateOptions(options)
  }

  public func setOpenState(_ value: NSNumber?) {
    guard let value else { return }
    if window == nil {
      pendingOpenState = value.boolValue
      return
    }
    presenter.setOpenState(value.boolValue, preferredIndex: options.initialSnapIndex)
  }

  public func handleCommand(_ command: NSDictionary?) {
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

  func dispatchEvent(_ name: String, payload: [AnyHashable: Any]?) {
    guard let manager = manager, let node = node else { return }
    let selector = NSSelectorFromString("zynth_dispatchEvent:payload:toNode:")
    guard let method = manager.method(for: selector) else { return }
    typealias Imp = @convention(c) (AnyObject, Selector, NSString, NSDictionary?, ZynthNode) -> Void
    let function = unsafeBitCast(method, to: Imp.self)
    function(manager, selector, name as NSString, payload as NSDictionary?, node)
  }
}
