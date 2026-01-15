//
//  ZynthKeyboardAvoidingView.swift
//  ZynthKeyboard
//
//  A view that adjusts its layout when the keyboard appears
//

import UIKit
import ZynthKit

@objc public enum KeyboardAvoidingBehavior: Int {
  case padding = 0
  case position = 1
  case height = 2
}

@objcMembers
public final class ZynthKeyboardAvoidingView: UIView {
  
  // MARK: - Properties
  
  private var behavior: KeyboardAvoidingBehavior = .padding
  private var keyboardVerticalOffset: CGFloat = 0
  private var isEnabled: Bool = true
  private var observers: [NSObjectProtocol] = []
  
  private var currentKeyboardHeight: CGFloat = 0
  private var originalTransform: CGAffineTransform = .identity
  private var originalHeight: CGFloat = 0
  private weak var manager: SNUIManager?
  private weak var node: SNNode?
  private var displayLink: CADisplayLink?
  private var animationStartTime: CFTimeInterval = 0
  private var animationDuration: CFTimeInterval = 0.25
  private var animationCurve: UIView.AnimationCurve = .easeInOut
  private var animationStartOverlap: CGFloat = 0
  private var animationTargetOverlap: CGFloat = 0
  private var currentOverlap: CGFloat = 0
  private var baseStyleSnapshot: [String: Any]?
  private var basePaddingBottom: CGFloat?
  private var baseHeightValue: Any?
  private var baseFlexValue: Any?
  private var baseFlexGrowValue: Any?
  private var baseFlexShrinkValue: Any?
  private var baseFlexBasisValue: Any?
  private var baseLayoutHeight: CGFloat?
  private var transitionObservers: [NSObjectProtocol] = []
  private var transitionFreezeCount: Int = 0
  
  // MARK: - Lifecycle
  
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
    startObserving()
    startObservingTransitions()
  }
  
  deinit {
    stopObserving()
  }
  
  @objc public func cleanup() {
    stopObserving()
    resetLayout()
    detachFromManager()
  }

  @objc public func attachToManager(_ manager: SNUIManager?, node: SNNode?) {
    self.manager = manager
    self.node = node
  }

  @objc public func detachFromManager() {
    manager = nil
    node = nil
  }
  
  // MARK: - Configuration
  
  @objc public func setBehavior(_ behaviorString: String) {
    switch behaviorString.lowercased() {
    case "padding":
      behavior = .padding
    case "position":
      behavior = .position
    case "height":
      behavior = .height
    default:
      behavior = .padding
    }
    baseStyleSnapshot = nil
    basePaddingBottom = nil
    baseHeightValue = nil
    baseFlexValue = nil
    baseFlexGrowValue = nil
    baseFlexShrinkValue = nil
    baseFlexBasisValue = nil
    baseLayoutHeight = nil
  }
  
  @objc public func setKeyboardVerticalOffset(_ offset: CGFloat) {
    keyboardVerticalOffset = offset
  }
  
  @objc public func setEnabled(_ enabled: Bool) {
    isEnabled = enabled
    if !enabled {
      resetLayout()
    }
  }
  
  // MARK: - Keyboard Observation
  
  private func startObserving() {
    let willShowObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillShowNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardWillShow(notification)
    }
    observers.append(willShowObserver)
    
    let willHideObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillHideNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardWillHide(notification)
    }
    observers.append(willHideObserver)
    
    let willChangeFrameObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillChangeFrameNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardWillChangeFrame(notification)
    }
    observers.append(willChangeFrameObserver)
  }
  
  private func stopObserving() {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
    stopObservingTransitions()
  }

  private func startObservingTransitions() {
    let willObserver = NotificationCenter.default.addObserver(
      forName: Notification.Name("ZynthScreenTransitionWillBegin"),
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.transitionFreezeCount += 1
    }
    transitionObservers.append(willObserver)

    let didObserver = NotificationCenter.default.addObserver(
      forName: Notification.Name("ZynthScreenTransitionDidEnd"),
      object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.transitionFreezeCount = max(0, self.transitionFreezeCount - 1)
    }
    transitionObservers.append(didObserver)
  }

  private func stopObservingTransitions() {
    for observer in transitionObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    transitionObservers.removeAll()
    transitionFreezeCount = 0
  }
  
  // MARK: - Keyboard Event Handlers
  
  private func handleKeyboardWillShow(_ notification: Notification) {
    guard isEnabled, let userInfo = notification.userInfo else { return }
    adjustForKeyboard(userInfo: userInfo, isShowing: true)
  }
  
  private func handleKeyboardWillHide(_ notification: Notification) {
    guard isEnabled, let userInfo = notification.userInfo else { return }
    adjustForKeyboard(userInfo: userInfo, isShowing: false)
  }
  
  private func handleKeyboardWillChangeFrame(_ notification: Notification) {
    guard isEnabled, let userInfo = notification.userInfo else { return }
    
    guard let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
      return
    }
    
    let screenHeight = UIScreen.main.bounds.height
    let isShowing = endFrame.origin.y < screenHeight
    adjustForKeyboard(userInfo: userInfo, isShowing: isShowing)
  }
  
  // MARK: - Layout Adjustment
  
  private func adjustForKeyboard(userInfo: [AnyHashable: Any], isShowing: Bool) {
    if shouldFreezeForTransition() {
      stopKeyboardAnimation()
      return
    }

    guard let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
      return
    }
    
    let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
    let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
    let curve = UIView.AnimationCurve(rawValue: Int(curveRaw)) ?? .easeInOut
    
    // Calculate keyboard overlap with this view
    let viewFrameInWindow = convert(bounds, to: nil)
    let viewBottom = viewFrameInWindow.maxY
    let keyboardTop = endFrame.origin.y
    
    let overlap: CGFloat
    if isShowing {
      overlap = max(0, viewBottom - keyboardTop) + keyboardVerticalOffset
    } else {
      overlap = 0
    }
    
    currentKeyboardHeight = isShowing ? endFrame.height : 0
    
    startKeyboardAnimation(to: overlap, duration: duration, curve: curve)
  }

  private func shouldFreezeForTransition() -> Bool {
    if transitionFreezeCount > 0 {
      return true
    }

    guard let viewController = findContainingViewController() else { return false }
    if viewController.isBeingDismissed || viewController.isMovingFromParent {
      return true
    }
    if
      let coordinator = viewController.transitionCoordinator,
      coordinator.isAnimated,
      coordinator.viewController(forKey: .from) === viewController
    {
      return true
    }
    if
      let navigationController = viewController.navigationController,
      let coordinator = navigationController.transitionCoordinator,
      coordinator.isAnimated,
      coordinator.viewController(forKey: .from) === viewController
    {
      return true
    }
    return false
  }

  private func findContainingViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController {
        return controller
      }
      responder = next
    }
    return nil
  }
  
  private func applyAdjustment(overlap: CGFloat) {
    switch behavior {
    case .padding:
      applyYogaAdjustment(overlap: overlap)
      
    case .position:
      // Translate the view upward
      transform = overlap > 0 ? CGAffineTransform(translationX: 0, y: -overlap) : .identity
      
    case .height:
      applyYogaAdjustment(overlap: overlap)
    }
  }
  
  private func resetLayout() {
    transform = .identity
    stopKeyboardAnimation()
    applyAdjustment(overlap: 0)
    currentKeyboardHeight = 0
    currentOverlap = 0
    baseStyleSnapshot = nil
    basePaddingBottom = nil
    baseHeightValue = nil
    baseFlexValue = nil
    baseFlexGrowValue = nil
    baseFlexShrinkValue = nil
    baseFlexBasisValue = nil
    baseLayoutHeight = nil
  }
  
  // MARK: - Intrinsic Content Size
  
  public override var intrinsicContentSize: CGSize {
    var size = super.intrinsicContentSize
    if behavior == .padding && currentKeyboardHeight > 0 {
      size.height += currentKeyboardHeight + keyboardVerticalOffset
    }
    return size
  }

  // MARK: - Native Yoga Adjustment

  private func applyYogaAdjustment(overlap: CGFloat) {
    guard let manager, let node else {
      layoutMargins.bottom = overlap
      setNeedsLayout()
      return
    }

    ensureBaseStyleSnapshot(node: node)

    let rawStyle = baseStyleSnapshot ?? (node.latestStyle as? [String: Any] ?? [:])
    var updated = rawStyle

    if behavior == .padding {
      let base = basePaddingBottom ?? 0
      updated["paddingBottom"] = NSNumber(value: Double(base + overlap))
    }

    if behavior == .height {
      if overlap <= 0 {
        baseLayoutHeight = nil
        if let baseHeightValue {
          updated["height"] = baseHeightValue
        } else {
          updated["height"] = NSNull()
        }
        if let baseFlexValue {
          updated["flex"] = baseFlexValue
        } else {
          updated["flex"] = NSNull()
        }
        if let baseFlexGrowValue {
          updated["flexGrow"] = baseFlexGrowValue
        } else {
          updated["flexGrow"] = NSNull()
        }
        if let baseFlexShrinkValue {
          updated["flexShrink"] = baseFlexShrinkValue
        } else {
          updated["flexShrink"] = NSNull()
        }
        if let baseFlexBasisValue {
          updated["flexBasis"] = baseFlexBasisValue
        } else {
          updated["flexBasis"] = NSNull()
        }
      } else {
        if baseLayoutHeight == nil {
          baseLayoutHeight = bounds.height
        }
        let baseline = baseLayoutHeight ?? bounds.height
        let targetHeight = max(0, baseline - overlap)
        updated["height"] = NSNumber(value: Double(targetHeight))
        updated["flex"] = NSNumber(value: 0)
        updated["flexGrow"] = NSNumber(value: 0)
        updated["flexShrink"] = NSNumber(value: 0)
        updated["flexBasis"] = NSNull()
      }
    }

    let style: [AnyHashable: Any] = Dictionary(
      uniqueKeysWithValues: updated.map { (key, value) in
        (key as AnyHashable, value)
      }
    )
    manager.setStyle(NSNumber(value: node.nid), style: style)
  }

  private func ensureBaseStyleSnapshot(node: SNNode) {
    if baseStyleSnapshot != nil || basePaddingBottom != nil || baseHeightValue != nil {
      return
    }

    let style = node.latestStyle as? [String: Any] ?? [:]
    baseStyleSnapshot = style
    basePaddingBottom = resolvePaddingBottom(style: style)
    baseHeightValue = style["height"]
    baseFlexValue = style["flex"]
    baseFlexGrowValue = style["flexGrow"]
    baseFlexShrinkValue = style["flexShrink"]
    baseFlexBasisValue = style["flexBasis"]
  }

  private func resolvePaddingBottom(style: [String: Any]) -> CGFloat {
    let bottom = style["paddingBottom"] ?? style["paddingVertical"] ?? style["padding"]
    if let number = bottom as? NSNumber {
      return CGFloat(truncating: number)
    }
    if let string = bottom as? String {
      return CGFloat(Double(string) ?? 0)
    }
    return 0
  }

  // MARK: - Keyboard Animation

  private func startKeyboardAnimation(to overlap: CGFloat, duration: Double, curve: UIView.AnimationCurve) {
    if !isEnabled {
      return
    }

    animationStartOverlap = currentOverlap
    animationTargetOverlap = overlap
    animationDuration = max(duration, 0.016)
    animationCurve = curve
    animationStartTime = CACurrentMediaTime()

    if displayLink == nil {
      let link = CADisplayLink(target: self, selector: #selector(handleDisplayLink(_:)))
      link.add(to: .main, forMode: .common)
      displayLink = link
    }

    if animationDuration <= 0 {
      applyAdjustment(overlap: overlap)
      currentOverlap = overlap
      stopKeyboardAnimation()
    }
  }

  private func stopKeyboardAnimation() {
    displayLink?.invalidate()
    displayLink = nil
  }

  @objc private func handleDisplayLink(_ link: CADisplayLink) {
    let elapsed = CACurrentMediaTime() - animationStartTime
    let progress = min(1, max(0, elapsed / animationDuration))
    let eased = applyCurve(progress)
    let overlap = animationStartOverlap + (animationTargetOverlap - animationStartOverlap) * CGFloat(eased)
    applyAdjustment(overlap: overlap)
    currentOverlap = overlap
    if progress >= 1 {
      stopKeyboardAnimation()
      if animationTargetOverlap == 0 {
        baseStyleSnapshot = nil
        basePaddingBottom = nil
        baseHeightValue = nil
      }
    }
  }

  private func applyCurve(_ progress: Double) -> Double {
    switch animationCurve {
    case .easeIn:
      return progress * progress
    case .easeOut:
      return 1 - pow(1 - progress, 2)
    case .easeInOut:
      return progress * progress * (3 - 2 * progress)
    case .linear:
      return progress
    @unknown default:
      return progress
    }
  }
}
