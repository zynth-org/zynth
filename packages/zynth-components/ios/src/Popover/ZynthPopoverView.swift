import ZynthKit
import UIKit

@objcMembers
public final class ZynthPopoverContentView: UIView {
  public override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    setParked(true)
    clipsToBounds = false
  }

  public func setParked(_ value: Bool) {
    isHidden = value
    alpha = value ? 0 : 1
    isUserInteractionEnabled = !value
    accessibilityElementsHidden = value
  }

  public func reset() {
    setParked(true)
  }
}

@objcMembers
public final class ZynthPopoverTriggerView: UIView {
  public weak var popoverView: ZynthPopoverView?

  private let overlayButton: UIButton = {
    let button = UIButton(type: .custom)
    button.backgroundColor = .clear
    return button
  }()

  public override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    isUserInteractionEnabled = true
    addSubview(overlayButton)
    overlayButton.addTarget(self, action: #selector(handleTap), for: .touchUpInside)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    overlayButton.frame = bounds
    bringSubviewToFront(overlayButton)
  }

  @objc private func handleTap() {
    popoverView?.showFromTrigger()
  }

  public func reset() {
    popoverView = nil
  }
}

private struct PopoverShowRequest {
  let source: String
  let anchorNodeId: NSNumber?
  let x: NSNumber?
  let y: NSNumber?
}

@objcMembers
public final class ZynthPopoverView: UIView {
  private weak var manager: ZynthUIManager?
  private weak var node: ZynthNode?

  public var hasOnOpenHandler: Bool = false
  public var hasOnCloseHandler: Bool = false

  private let parkingContainer: UIView = {
    let view = UIView()
    view.alpha = 0
    view.isUserInteractionEnabled = false
    view.accessibilityElementsHidden = true
    return view
  }()

  private weak var triggerView: ZynthPopoverTriggerView?
  private weak var contentView: ZynthPopoverContentView?
  private weak var activeController: ZynthPopoverContainerController?
  private var pendingShowRequest: PopoverShowRequest?
  private var isReparentingContent = false

  private var surfaceColor: UIColor?
  private var cornerRadius: CGFloat = 16
  private var elevation: CGFloat = 8
  private var dismissOnOutsidePress: Bool = true
  private var offsetX: CGFloat = 0
  private var offsetY: CGFloat = 8
  private var showArrowOverride: Bool?

  public override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    clipsToBounds = false
    super.addSubview(parkingContainer)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    parkingContainer.frame = .zero
  }

  public override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    if subview === parkingContainer {
      return
    }
    if let trigger = subview as? ZynthPopoverTriggerView {
      attachTrigger(trigger)
      return
    }
    if let content = subview as? ZynthPopoverContentView {
      attachContent(content)
    }
  }

  public override func willRemoveSubview(_ subview: UIView) {
    super.willRemoveSubview(subview)
    if subview === triggerView {
      triggerView?.popoverView = nil
      triggerView = nil
      return
    }
    if !isReparentingContent && subview === contentView {
      contentView = nil
    }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      dismiss()
    }
  }

  public func bind(manager: ZynthUIManager, node: ZynthNode) {
    self.manager = manager
    self.node = node
  }

  public func reset() {
    dismiss()
    hasOnOpenHandler = false
    hasOnCloseHandler = false
    triggerView?.popoverView = nil
    triggerView = nil
    contentView?.reset()
    contentView = nil
    manager = nil
    node = nil
    surfaceColor = nil
    cornerRadius = 16
    elevation = 8
    dismissOnOutsidePress = true
    offsetX = 0
    offsetY = 8
    showArrowOverride = nil
    pendingShowRequest = nil
  }

  public func setSurfaceColorValue(_ value: UIColor?) {
    surfaceColor = value
    activeController?.updateAppearance(
      surfaceColor: resolvedSurfaceColor(),
      cornerRadius: cornerRadius,
      elevation: elevation
    )
  }

  public func setCornerRadiusValue(_ value: NSNumber?) {
    guard let value else { return }
    cornerRadius = max(CGFloat(value.doubleValue), 0)
    activeController?.updateAppearance(
      surfaceColor: resolvedSurfaceColor(),
      cornerRadius: cornerRadius,
      elevation: elevation
    )
  }

  public func setElevationValue(_ value: NSNumber?) {
    guard let value else { return }
    elevation = max(CGFloat(value.doubleValue), 0)
    activeController?.updateAppearance(
      surfaceColor: resolvedSurfaceColor(),
      cornerRadius: cornerRadius,
      elevation: elevation
    )
  }

  public func setDismissOnOutsidePress(_ value: NSNumber?) {
    guard let value else { return }
    dismissOnOutsidePress = value.boolValue
    activeController?.dismissOnOutsidePress = dismissOnOutsidePress
  }

  public func setOffsetXValue(_ value: NSNumber?) {
    guard let value else { return }
    offsetX = CGFloat(value.doubleValue)
  }

  public func setOffsetYValue(_ value: NSNumber?) {
    guard let value else { return }
    offsetY = CGFloat(value.doubleValue)
  }

  public func setShowArrowValue(_ value: NSNumber?) {
    showArrowOverride = value?.boolValue
  }

  public func showFromTrigger() {
    show(
      request: PopoverShowRequest(
        source: "trigger",
        anchorNodeId: nil,
        x: nil,
        y: nil
      )
    )
  }

  public func handleCommand(_ command: NSDictionary?) {
    guard let command = command as? [String: Any], let type = command["type"] as? String else {
      return
    }

    switch type {
    case "show":
      let request = PopoverShowRequest(
        source: (command["source"] as? String) ?? "trigger",
        anchorNodeId: command["anchorNodeId"] as? NSNumber,
        x: command["x"] as? NSNumber,
        y: command["y"] as? NSNumber
      )
      show(request: request)
    case "dismiss":
      dismiss()
    default:
      break
    }
  }

  public func dismiss() {
    guard let controller = activeController else { return }
    controller.onDidDismiss = nil
    controller.dismiss(animated: true) { [weak self] in
      self?.handleDismiss()
    }
  }

  private func show(request: PopoverShowRequest) {
    guard window != nil else { return }
    guard let content = contentView else { return }
    guard let presenter = findPresenterViewController() else { return }

    if activeController != nil {
      pendingShowRequest = request
      dismiss()
      return
    }

    let anchor = resolveAnchor(request: request, presenter: presenter)
    let controller = ZynthPopoverContainerController(
      host: self,
      dismissOnOutsidePress: dismissOnOutsidePress
    )
    controller.modalPresentationStyle = .popover
    controller.dismissOnOutsidePress = dismissOnOutsidePress
    controller.onDidDismiss = { [weak self] in
      self?.handleDismiss()
    }
    controller.updateAppearance(
      surfaceColor: resolvedSurfaceColor(),
      cornerRadius: cornerRadius,
      elevation: elevation
    )
    controller.loadViewIfNeeded()
    controller.attachContent(content)
    controller.refreshPreferredContentSize()

    guard let popover = controller.popoverPresentationController else { return }
    popover.delegate = controller
    if shouldShowArrow(for: request) {
      popover.permittedArrowDirections = .any
    } else {
      popover.permittedArrowDirections = []
    }
    popover.sourceView = anchor.view
    popover.sourceRect = anchor.rect
    popover.backgroundColor = .clear

    activeController = controller
    presenter.present(controller, animated: true) { [weak self] in
      guard let self else { return }
      if self.hasOnOpenHandler {
        self.dispatchEvent("onOpen", payload: [:])
      }
    }
  }

  private func resolveAnchor(
    request: PopoverShowRequest,
    presenter: UIViewController
  ) -> (view: UIView, rect: CGRect) {
    if request.source == "coordinates",
      let rawX = request.x?.doubleValue,
      let rawY = request.y?.doubleValue {
      let baseView = presenter.view ?? self
      let x = CGFloat(rawX) + offsetX
      let y = CGFloat(rawY) + offsetY
      return (baseView, CGRect(x: x, y: y, width: 1, height: 1))
    }

    if request.source == "anchor",
      let anchorId = request.anchorNodeId,
      let anchorNode = manager?.getNodeState(anchorId) {
      let anchorView = anchorNode.view
      return (anchorView, anchorView.bounds.offsetBy(dx: offsetX, dy: offsetY))
    }

    if let triggerView {
      return (triggerView, triggerView.bounds.offsetBy(dx: offsetX, dy: offsetY))
    }

    if let anchorId = request.anchorNodeId,
      let anchorNode = manager?.getNodeState(anchorId) {
      let anchorView = anchorNode.view
      return (anchorView, anchorView.bounds.offsetBy(dx: offsetX, dy: offsetY))
    }

    let fallback = presenter.view ?? self
    return (fallback, CGRect(x: offsetX, y: offsetY, width: 1, height: 1))
  }

  private func attachTrigger(_ trigger: ZynthPopoverTriggerView) {
    if triggerView === trigger { return }
    triggerView?.popoverView = nil
    triggerView = trigger
    trigger.popoverView = self
  }

  private func attachContent(_ content: ZynthPopoverContentView) {
    if contentView === content { return }
    if let previous = contentView, previous !== content {
      moveContentToParking(previous)
      previous.setParked(true)
    }
    contentView = content
    moveContentToParking(content)
    content.setParked(true)
  }

  private func moveContentToParking(_ content: ZynthPopoverContentView) {
    if content.superview === parkingContainer {
      return
    }
    isReparentingContent = true
    defer { isReparentingContent = false }
    content.removeFromSuperview()
    parkingContainer.addSubview(content)
  }

  private func handleDismiss() {
    let content = contentView
    if let content {
      content.removeFromSuperview()
      parkingContainer.addSubview(content)
      content.setParked(true)
    }
    activeController = nil
    let pending = pendingShowRequest
    pendingShowRequest = nil
    if hasOnCloseHandler {
      dispatchEvent("onClose", payload: [:])
    }
    if let pending, window != nil {
      DispatchQueue.main.async { [weak self] in
        self?.show(request: pending)
      }
    }
  }

  private func resolvedSurfaceColor() -> UIColor {
    if let surfaceColor {
      return surfaceColor
    }
    return UIColor.systemBackground
  }

  private func shouldShowArrow(for request: PopoverShowRequest) -> Bool {
    if let override = showArrowOverride {
      return override
    }
    return request.source != "coordinates"
  }

  private func dispatchEvent(_ name: String, payload: [AnyHashable: Any]?) {
    guard let manager = manager, let node = node else { return }
    let selector = NSSelectorFromString("zynth_dispatchEvent:payload:toNode:")
    guard let method = manager.method(for: selector) else { return }
    typealias Imp = @convention(c) (AnyObject, Selector, NSString, NSDictionary?, ZynthNode) -> Void
    let function = unsafeBitCast(method, to: Imp.self)
    function(manager, selector, name as NSString, payload as NSDictionary?, node)
  }

  private func findPresenterViewController() -> UIViewController? {
    if let hostController = nearestViewController(startingAt: self) {
      return topMostPresentedController(startingAt: hostController)
    }

    var responder: UIResponder? = self
    while let nextResponder = responder?.next {
      if let controller = nextResponder as? UIViewController {
        return topMostPresentedController(startingAt: controller)
      }
      responder = nextResponder
    }

    if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
      let window = scene.windows.first(where: { $0.isKeyWindow }) {
      if let root = window.rootViewController {
        return topMostPresentedController(startingAt: root)
      }
    }
    return nil
  }

  private func nearestViewController(startingAt view: UIView?) -> UIViewController? {
    var current = view
    while let candidate = current {
      if let next = candidate.next as? UIViewController {
        return next
      }
      current = candidate.superview
    }
    return nil
  }

  private func topMostPresentedController(startingAt base: UIViewController) -> UIViewController {
    var current = base
    while let presented = current.presentedViewController, !presented.isBeingDismissed {
      current = presented
    }
    return current
  }
}

private final class ZynthPopoverContainerController:
  UIViewController,
  UIPopoverPresentationControllerDelegate,
  UIAdaptivePresentationControllerDelegate {
  weak var host: ZynthPopoverView?

  var dismissOnOutsidePress: Bool
  var onDidDismiss: (() -> Void)?

  private let surfaceView = UIView()
  private weak var contentView: ZynthPopoverContentView?
  private var didNotifyDismiss = false
  private var isComputingPreferredSize = false

  init(host: ZynthPopoverView, dismissOnOutsidePress: Bool) {
    self.host = host
    self.dismissOnOutsidePress = dismissOnOutsidePress
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    surfaceView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(surfaceView)
    NSLayoutConstraint.activate([
      surfaceView.topAnchor.constraint(equalTo: view.topAnchor),
      surfaceView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      surfaceView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      surfaceView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    presentationController?.delegate = self
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    refreshPreferredContentSize()
  }

  func attachContent(_ content: ZynthPopoverContentView) {
    content.removeFromSuperview()
    content.translatesAutoresizingMaskIntoConstraints = false
    surfaceView.addSubview(content)
    NSLayoutConstraint.activate([
      content.topAnchor.constraint(equalTo: surfaceView.topAnchor),
      content.bottomAnchor.constraint(equalTo: surfaceView.bottomAnchor),
      content.leadingAnchor.constraint(equalTo: surfaceView.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: surfaceView.trailingAnchor),
    ])
    content.setParked(false)
    contentView = content
  }

  func updateAppearance(surfaceColor: UIColor, cornerRadius: CGFloat, elevation: CGFloat) {
    surfaceView.backgroundColor = surfaceColor
    surfaceView.layer.cornerRadius = cornerRadius
    surfaceView.layer.masksToBounds = false
    surfaceView.layer.shadowColor = UIColor.black.cgColor
    surfaceView.layer.shadowOpacity = 0.16
    surfaceView.layer.shadowRadius = max(4, elevation)
    surfaceView.layer.shadowOffset = CGSize(width: 0, height: max(2, elevation / 2))
  }

  func refreshPreferredContentSize() {
    if isComputingPreferredSize { return }
    guard let contentView else {
      preferredContentSize = CGSize(width: 1, height: 1)
      return
    }
    isComputingPreferredSize = true
    defer { isComputingPreferredSize = false }

    let autoLayoutCompressed = contentView.systemLayoutSizeFitting(
      CGSize(width: UIView.layoutFittingCompressedSize.width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel
    )
    let fitting = contentView.sizeThatFits(
      CGSize(width: UIView.layoutFittingExpandedSize.width, height: UIView.layoutFittingExpandedSize.height)
    )
    let subviewsUnion = contentView.subviews.reduce(CGRect.null) { partial, subview in
      return partial.union(subview.frame)
    }.size

    let width = max(
      autoLayoutCompressed.width,
      fitting.width,
      subviewsUnion.width,
      1
    )
    let height = max(
      autoLayoutCompressed.height,
      fitting.height,
      subviewsUnion.height,
      1
    )
    let nextSize = CGSize(width: width, height: height)
    if preferredContentSize != nextSize {
      preferredContentSize = nextSize
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if presentingViewController == nil {
      notifyDidDismiss()
    }
  }

  func adaptivePresentationStyle(
    for controller: UIPresentationController,
    traitCollection: UITraitCollection
  ) -> UIModalPresentationStyle {
    return .none
  }

  func presentationControllerShouldDismiss(_ presentationController: UIPresentationController) -> Bool {
    return dismissOnOutsidePress
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    notifyDidDismiss()
  }

  private func notifyDidDismiss() {
    if didNotifyDismiss { return }
    didNotifyDismiss = true
    onDidDismiss?()
  }
}
