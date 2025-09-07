import Foundation
import RuneKit
import UIKit

@objcMembers
public final class RuneScreenView: UIView {
  private enum Constants {
    static let animationDuration: TimeInterval = 0.3
    static let pushOffset: CGFloat = 30
    static let modalOffset: CGFloat = 80
    static let zoomScaleStart: CGFloat = 0.92
  }

  weak var container: RuneScreenContainerView? {
    didSet {
      applyPendingActiveStateIfNeeded()
    }
  }

  @objc public private(set) var screenKey: String = ""
  @objc public private(set) var isScreenActive: Bool = false
  @objc public private(set) var animationType: RuneScreenAnimation = .push
  @objc public private(set) var gestureEnabled: Bool = true
  @objc public private(set) var isInTransition: Bool = false

  private var pendingActiveState: Bool?
  private var currentAnimator: UIViewPropertyAnimator?
  private var isControlledByNeighbor: Bool = false
  private var isPendingRemoval: Bool = false

  private weak var manager: SNUIManager?
  private weak var node: SNNode?

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
    clipsToBounds = false
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    for child in subviews {
      child.frame = bounds
    }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    applyPendingActiveStateIfNeeded()
  }

  public func bind(manager: SNUIManager, node: SNNode) {
    self.manager = manager
    self.node = node
  }

  public func prepareForReuse() {
    cancelAnimation()
    resetTransforms()
    pendingActiveState = nil
    isScreenActive = false
    isInTransition = false
    isControlledByNeighbor = false
    isPendingRemoval = false
    manager = nil
    node = nil
  }

  public func setScreenKeyValue(_ value: NSString?) {
    screenKey = value as String? ?? ""
  }

  public func setActiveStateValue(_ value: NSNumber?) {
    let active = value?.boolValue ?? false
    pendingActiveState = active
    applyPendingActiveStateIfNeeded()
  }

  public func setAnimationTypeString(_ value: NSString?) {
    animationType = RuneScreenAnimation(string: value as String?)
  }

  public func setGestureEnabledValue(_ value: NSNumber?) {
    gestureEnabled = value?.boolValue ?? true
    isUserInteractionEnabled = gestureEnabled
  }

  public func startExitAnimationAndCleanup() {
    if isPendingRemoval {
      return
    }
    isPendingRemoval = true
    pendingActiveState = nil
    if isScreenActive {
      isScreenActive = false
    }
    performExitAnimation(isDetaching: true)
  }

  private func applyPendingActiveStateIfNeeded() {
    guard let target = pendingActiveState, container != nil, superview != nil else {
      return
    }
    pendingActiveState = nil

    if target == isScreenActive {
      return
    }

    let wasActive = isScreenActive
    isScreenActive = target

    if target && !wasActive {
      performEnterAnimation()
    } else if !target && wasActive {
      performExitAnimation(isDetaching: isPendingRemoval)
    }
  }

  private func performEnterAnimation() {
    if isControlledByNeighbor {
      return
    }

    if previousScreen() == nil {
      cancelAnimation()
      dispatchEvent(name: "onWillAppear")
      isHidden = false
      resetTransforms()
      container?.updateScreenVisibility()
      dispatchEvent(name: "onDidAppear")
      return
    }

    cancelAnimation()
    dispatchEvent(name: "onWillAppear")

    guard animationType != .none else {
      isHidden = false
      resetTransforms()
      container?.updateScreenVisibility()
      dispatchEvent(name: "onDidAppear")
      return
    }

    isInTransition = true
    isHidden = false

    switch animationType {
    case .push:
      transform = CGAffineTransform(translationX: Constants.pushOffset, y: 0)
      alpha = 0
    case .modal:
      transform = CGAffineTransform(translationX: 0, y: Constants.modalOffset)
      alpha = 0
    case .zoom:
      transform = CGAffineTransform(scaleX: Constants.zoomScaleStart, y: Constants.zoomScaleStart)
      alpha = 0
    case .fade:
      alpha = 0
    case .none:
      break
    }

    let animator = UIViewPropertyAnimator(duration: Constants.animationDuration, curve: .easeInOut)
    animator.addAnimations { [weak self] in
      guard let self = self else { return }
      self.transform = .identity
      self.alpha = 1
    }

    switch animationType {
    case .push:
      animatePreviousScreenOnEnter(animator: animator, translationX: Constants.pushOffset)
    case .zoom:
      animatePreviousScreenOnEnterZoom(animator: animator)
    default:
      break
    }

    animator.addCompletion { [weak self] _ in
      guard let self = self else { return }
      self.isInTransition = false
      self.resetTransforms()
      self.container?.updateScreenVisibility()
      self.dispatchEvent(name: "onDidAppear")
      self.currentAnimator = nil
    }

    currentAnimator = animator
    container?.updateScreenVisibility()
    animator.startAnimation()
  }

  private func performExitAnimation(isDetaching: Bool) {
    if isControlledByNeighbor {
      if isDetaching {
        container?.finishRemoval(screen: self)
      }
      return
    }

    cancelAnimation()
    dispatchEvent(name: "onWillDisappear")

    guard animationType != .none else {
      isHidden = true
      resetTransforms()
      container?.updateScreenVisibility()
      dispatchEvent(name: "onDidDisappear")
      if isDetaching {
        container?.finishRemoval(screen: self)
      }
      return
    }

    isInTransition = true

    let animator = UIViewPropertyAnimator(duration: Constants.animationDuration, curve: .easeInOut)

    animator.addAnimations { [weak self] in
      guard let self = self else { return }
      switch self.animationType {
      case .push:
        self.transform = CGAffineTransform(translationX: Constants.pushOffset, y: 0)
        self.alpha = 0
      case .modal:
        self.transform = CGAffineTransform(translationX: 0, y: Constants.modalOffset)
        self.alpha = 0
      case .zoom:
        self.transform = CGAffineTransform(scaleX: Constants.zoomScaleStart, y: Constants.zoomScaleStart)
        self.alpha = 0
      case .fade:
        self.alpha = 0
      case .none:
        break
      }
    }

    switch animationType {
    case .push:
      animatePreviousScreenOnExit(animator: animator, startTranslationX: -Constants.pushOffset)
    case .zoom:
      animatePreviousScreenOnExitZoom(animator: animator)
    default:
      break
    }

    animator.addCompletion { [weak self] _ in
      guard let self = self else { return }
      self.isInTransition = false
      self.isHidden = true
      self.resetTransforms()
      self.container?.updateScreenVisibility()
      self.dispatchEvent(name: "onDidDisappear")
      self.currentAnimator = nil
      if isDetaching {
        self.container?.finishRemoval(screen: self)
      }
    }

    currentAnimator = animator
    container?.updateScreenVisibility()
    animator.startAnimation()
  }

  private func animatePreviousScreenOnEnter(animator: UIViewPropertyAnimator, translationX: CGFloat) {
    guard let previous = previousScreen() else { return }
    previous.cancelAnimation()
    previous.isControlledByNeighbor = true
    previous.isInTransition = true
    previous.isHidden = false
    previous.alpha = 1
    previous.transform = .identity

    animator.addAnimations {
      previous.transform = CGAffineTransform(translationX: -translationX, y: 0)
      previous.alpha = 0
    }

    animator.addCompletion { _ in
      previous.isControlledByNeighbor = false
      previous.isInTransition = false
      previous.resetTransforms()
      previous.container?.updateScreenVisibility()
    }
  }

  private func animatePreviousScreenOnEnterZoom(animator: UIViewPropertyAnimator) {
    guard let previous = previousScreen() else { return }
    previous.cancelAnimation()
    previous.isControlledByNeighbor = true
    previous.isInTransition = true
    previous.isHidden = false
    previous.alpha = 1
    previous.transform = .identity

    animator.addAnimations {
      previous.transform = CGAffineTransform(scaleX: Constants.zoomScaleStart, y: Constants.zoomScaleStart)
      previous.alpha = 0
    }

    animator.addCompletion { _ in
      previous.isControlledByNeighbor = false
      previous.isInTransition = false
      previous.resetTransforms()
      previous.container?.updateScreenVisibility()
    }
  }

  private func animatePreviousScreenOnExit(animator: UIViewPropertyAnimator, startTranslationX: CGFloat) {
    guard let previous = previousScreen() else { return }
    previous.cancelAnimation()
    previous.isControlledByNeighbor = true
    previous.isInTransition = true
    previous.isHidden = false
    previous.alpha = 0
    previous.transform = CGAffineTransform(translationX: startTranslationX, y: 0)

    animator.addAnimations {
      previous.transform = .identity
      previous.alpha = 1
    }

    animator.addCompletion { _ in
      previous.isControlledByNeighbor = false
      previous.isInTransition = false
      previous.resetTransforms()
      previous.container?.updateScreenVisibility()
    }
  }

  private func animatePreviousScreenOnExitZoom(animator: UIViewPropertyAnimator) {
    guard let previous = previousScreen() else { return }
    previous.cancelAnimation()
    previous.isControlledByNeighbor = true
    previous.isInTransition = true
    previous.isHidden = false
    previous.alpha = 0
    previous.transform = CGAffineTransform(scaleX: Constants.zoomScaleStart, y: Constants.zoomScaleStart)

    animator.addAnimations {
      previous.transform = .identity
      previous.alpha = 1
    }

    animator.addCompletion { _ in
      previous.isControlledByNeighbor = false
      previous.isInTransition = false
      previous.resetTransforms()
      previous.container?.updateScreenVisibility()
    }
  }

  private func previousScreen() -> RuneScreenView? {
    return container?.previousScreen(for: self)
  }

  private func cancelAnimation() {
    currentAnimator?.stopAnimation(true)
    currentAnimator = nil
    layer.removeAllAnimations()
    isInTransition = false
  }

  private func resetTransforms() {
    transform = .identity
    alpha = 1
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
