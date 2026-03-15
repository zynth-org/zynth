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
    guard window != nil else {
      // Ensure we do not keep an orphaned presented sheet after host detaches (e.g. HMR remount).
      presenter.dismiss()
      return
    }
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
    options.snapPoints = parsed
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

  public func setOverlayColorString(_ color: NSString?) {
    guard let parsed = BottomSheetColorParser.color(from: color as String?) else { return }
    options.overlayColor = parsed
    presenter.updateOptions(options)
  }

  public func setOverlayOpacityValue(_ value: NSNumber?) {
    guard let value else { return }
    options.overlayOpacity = min(max(CGFloat(value.floatValue), 0), 1)
    presenter.updateOptions(options)
  }

  public func setDismissOnOverlayPress(_ value: NSNumber?) {
    guard let value else { return }
    options.dismissOnOverlayPress = value.boolValue
    presenter.updateOptions(options)
  }

  public func setAllowDismissOnInteraction(_ value: NSNumber?) {
    guard let value else { return }
    options.allowDismissOnInteraction = value.boolValue
    presenter.updateOptions(options)
  }

  public func setDynamicContentHeight(_ value: NSNumber?) {
    guard let value else { return }
    options.dynamicContentHeight = value.boolValue
    presenter.updateOptions(options)
  }

  public func setContentHeightHint(_ value: NSNumber?) {
    options.contentHeightHint = value.map { CGFloat($0.doubleValue) }
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
    case "expand":
      presenter.expand()
    case "collapse":
      presenter.collapse()
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

private enum BottomSheetColorParser {
  static func color(from value: String?) -> UIColor? {
    guard var hex = value?.trimmingCharacters(in: .whitespacesAndNewlines),
      hex.hasPrefix("#")
    else {
      return nil
    }
    hex.removeFirst()
    let scanner = Scanner(string: hex)
    var hexNumber: UInt64 = 0
    guard scanner.scanHexInt64(&hexNumber) else { return nil }

    switch hex.count {
    case 3:
      let r = (hexNumber & 0xF00) >> 8
      let g = (hexNumber & 0x0F0) >> 4
      let b = hexNumber & 0x00F
      return UIColor(
        red: CGFloat((r << 4) + r) / 255,
        green: CGFloat((g << 4) + g) / 255,
        blue: CGFloat((b << 4) + b) / 255,
        alpha: 1
      )
    case 4:
      let a = (hexNumber & 0xF000) >> 12
      let r = (hexNumber & 0x0F00) >> 8
      let g = (hexNumber & 0x00F0) >> 4
      let b = hexNumber & 0x000F
      return UIColor(
        red: CGFloat((r << 4) + r) / 255,
        green: CGFloat((g << 4) + g) / 255,
        blue: CGFloat((b << 4) + b) / 255,
        alpha: CGFloat((a << 4) + a) / 255
      )
    case 6:
      return UIColor(
        red: CGFloat((hexNumber & 0xFF0000) >> 16) / 255,
        green: CGFloat((hexNumber & 0x00FF00) >> 8) / 255,
        blue: CGFloat(hexNumber & 0x0000FF) / 255,
        alpha: 1
      )
    case 8:
      return UIColor(
        red: CGFloat((hexNumber & 0x00FF_0000) >> 16) / 255,
        green: CGFloat((hexNumber & 0x0000_FF00) >> 8) / 255,
        blue: CGFloat(hexNumber & 0x0000_00FF) / 255,
        alpha: CGFloat((hexNumber & 0xFF00_0000) >> 24) / 255
      )
    default:
      return nil
    }
  }
}
