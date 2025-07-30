//
//  RuneKeyboardStickyView.swift
//  RuneKeyboard
//
//  A view that stays pinned above the keyboard
//

import UIKit

@objcMembers
public final class RuneKeyboardStickyView: UIView {
  
  // MARK: - Properties
  
  private var offset: CGFloat = 0
  private var observers: [NSObjectProtocol] = []
  private var currentKeyboardHeight: CGFloat = 0
  
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
    clipsToBounds = false
    startObserving()
  }
  
  deinit {
    stopObserving()
  }
  
  @objc public func cleanup() {
    stopObserving()
    resetPosition()
  }
  
  // MARK: - Configuration
  
  @objc public func setOffset(_ value: CGFloat) {
    offset = value
    updatePosition(animated: false)
  }
  
  // MARK: - Keyboard Observation
  
  private func startObserving() {
    let willShowObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillShowNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardChange(notification, isShowing: true)
    }
    observers.append(willShowObserver)
    
    let willHideObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillHideNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardChange(notification, isShowing: false)
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
  
  private func handleKeyboardChange(_ notification: Notification, isShowing: Bool) {
    guard let userInfo = notification.userInfo else { return }
    
    let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect ?? .zero
    let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
    let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
    let curve = UIView.AnimationCurve(rawValue: Int(curveRaw)) ?? .easeInOut
    
    currentKeyboardHeight = isShowing ? endFrame.height : 0
    
    let animator = UIViewPropertyAnimator(duration: duration, curve: curve) { [weak self] in
      self?.updatePosition(animated: true)
    }
    animator.startAnimation()
  }
  
  private func handleKeyboardWillChangeFrame(_ notification: Notification) {
    guard let userInfo = notification.userInfo else { return }
    
    guard let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
      return
    }
    
    let screenHeight = UIScreen.main.bounds.height
    let isShowing = endFrame.origin.y < screenHeight
    
    let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
    let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
    let curve = UIView.AnimationCurve(rawValue: Int(curveRaw)) ?? .easeInOut
    
    currentKeyboardHeight = isShowing ? (screenHeight - endFrame.origin.y) : 0
    
    let animator = UIViewPropertyAnimator(duration: duration, curve: curve) { [weak self] in
      self?.updatePosition(animated: true)
    }
    animator.startAnimation()
  }
  
  // MARK: - Position Updates
  
  private func updatePosition(animated: Bool) {
    // Move the view up by the keyboard height + offset
    let translation = currentKeyboardHeight > 0 ? -(currentKeyboardHeight + offset) : 0
    transform = CGAffineTransform(translationX: 0, y: translation)
  }
  
  private func resetPosition() {
    transform = .identity
    currentKeyboardHeight = 0
  }
}
