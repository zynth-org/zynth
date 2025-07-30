//
//  RuneKeyboardAvoidingView.swift
//  RuneKeyboard
//
//  A view that adjusts its layout when the keyboard appears
//

import UIKit

@objc public enum KeyboardAvoidingBehavior: Int {
  case padding = 0
  case position = 1
  case height = 2
}

@objcMembers
public final class RuneKeyboardAvoidingView: UIView {
  
  // MARK: - Properties
  
  private var behavior: KeyboardAvoidingBehavior = .padding
  private var keyboardVerticalOffset: CGFloat = 0
  private var isEnabled: Bool = true
  private var observers: [NSObjectProtocol] = []
  
  private var currentKeyboardHeight: CGFloat = 0
  private var originalTransform: CGAffineTransform = .identity
  private var originalHeight: CGFloat = 0
  
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
  }
  
  deinit {
    stopObserving()
  }
  
  @objc public func cleanup() {
    stopObserving()
    resetLayout()
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
    
    // Animate the adjustment
    let animator = UIViewPropertyAnimator(duration: duration, curve: curve) { [weak self] in
      self?.applyAdjustment(overlap: overlap)
    }
    animator.startAnimation()
  }
  
  private func applyAdjustment(overlap: CGFloat) {
    switch behavior {
    case .padding:
      // Adjust content inset / padding at the bottom
      // Since we can't directly modify Yoga padding from here,
      // we use a bottom constraint approach
      if let lastSubview = subviews.last {
        // We'll use a spacer approach - the JS side should handle this
        // For now, we just expose the value
      }
      // Apply via layout margin or safe area
      layoutMargins.bottom = overlap
      setNeedsLayout()
      
    case .position:
      // Translate the view upward
      transform = overlap > 0 ? CGAffineTransform(translationX: 0, y: -overlap) : .identity
      
    case .height:
      // Reduce the view's height
      if originalHeight == 0 {
        originalHeight = bounds.height
      }
      // This requires modifying the frame which may conflict with Yoga
      // Best handled via the JS-side for now
      layoutMargins.bottom = overlap
      setNeedsLayout()
    }
  }
  
  private func resetLayout() {
    transform = .identity
    layoutMargins.bottom = 0
    currentKeyboardHeight = 0
    setNeedsLayout()
  }
  
  // MARK: - Intrinsic Content Size
  
  public override var intrinsicContentSize: CGSize {
    var size = super.intrinsicContentSize
    if behavior == .padding && currentKeyboardHeight > 0 {
      size.height += currentKeyboardHeight + keyboardVerticalOffset
    }
    return size
  }
}
