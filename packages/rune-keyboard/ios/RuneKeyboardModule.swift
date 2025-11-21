//
//  RuneKeyboardModule.swift
//  RuneKeyboard
//
//  Monitors keyboard visibility and exposes state to JavaScript.
//  Keyboard dismiss is handled via the RuneKeyboardBridge module which
//  exposes a "dismiss" method callable from JS via __modules.call().
//

import RuneKit
import UIKit

@objc(RuneKeyboardModule)
public class RuneKeyboardModule: NSObject {

  private weak var runtime: RuneRuntime?
  private var observers: [NSObjectProtocol] = []
  private var lastState: KeyboardState?
  private let defaultState = KeyboardState(
    isVisible: false,
    height: 0,
    screenY: UIScreen.main.bounds.height,
    duration: 0,
    easing: "keyboard",
    isAnimating: false
  )

  // MARK: - Lifecycle

  init(runtime: RuneRuntime) {
    self.runtime = runtime
    super.init()
  }

  @discardableResult
  @objc public static func initialize(with runtime: RuneRuntime) -> RuneKeyboardModule {
    print("[RuneKeyboard] Initializing module")
    let module = RuneKeyboardModule(runtime: runtime)
    print("[RuneKeyboard] Registering bridge")
    module.registerBridge()
    print("[RuneKeyboard] Starting observation")
    module.startObserving()
    print("[RuneKeyboard] Module initialized and observing")
    return module
  }

  deinit {
    stopObserving()
  }

  /// Register the bridge module for JS→native communication
  private func registerBridge() {
    guard let runtime = runtime else { return }
    let bridge = RuneKeyboardBridge(keyboardModule: self)
    runtime.installModules([bridge])
    print("[RuneKeyboard] Bridge registered with runtime")
  }

  /// Dismiss the keyboard by resigning first responder
  public func dismissKeyboard() {
    DispatchQueue.main.async {
      print(
        "[RuneKeyboard] dismissKeyboard() called; rootView present:", self.runtime?.rootView != nil)
      // First try to end editing on the root view; if nothing is first responder, also send the resign action.
      if let root = self.runtime?.rootView {
        root.endEditing(true)
      }
      UIApplication.shared.sendAction(
        #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
  }

  // MARK: - Observation

  private func startObserving() {
    // Keyboard will show
    let willShowObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillShowNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardWillShow(notification)
    }
    observers.append(willShowObserver)

    // Keyboard will hide
    let willHideObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardWillHideNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardWillHide(notification)
    }
    observers.append(willHideObserver)

    // Keyboard did show (for final state)
    let didShowObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardDidShowNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardDidShow(notification)
    }
    observers.append(didShowObserver)

    // Keyboard did hide (for final state)
    let didHideObserver = NotificationCenter.default.addObserver(
      forName: UIResponder.keyboardDidHideNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyboardDidHide(notification)
    }
    observers.append(didHideObserver)

    // Keyboard will change frame (for interactive dismissal)
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
    guard let userInfo = notification.userInfo else { return }

    let state = extractKeyboardState(from: userInfo, isVisible: true, isAnimating: true)
    publishStateToJS(state)
  }

  private func handleKeyboardWillHide(_ notification: Notification) {
    guard let userInfo = notification.userInfo else { return }

    let state = extractKeyboardState(from: userInfo, isVisible: false, isAnimating: true)
    publishStateToJS(state)
  }

  private func handleKeyboardDidShow(_ notification: Notification) {
    guard let userInfo = notification.userInfo else { return }

    let state = extractKeyboardState(from: userInfo, isVisible: true, isAnimating: false)
    publishStateToJS(state)
  }

  private func handleKeyboardDidHide(_ notification: Notification) {
    let state = KeyboardState(
      isVisible: false,
      height: 0,
      screenY: UIScreen.main.bounds.height,
      duration: 0,
      easing: "keyboard",
      isAnimating: false
    )
    publishStateToJS(state)
  }

  private func handleKeyboardWillChangeFrame(_ notification: Notification) {
    guard let userInfo = notification.userInfo else { return }

    guard let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
      return
    }

    let screenHeight = UIScreen.main.bounds.height
    let isVisible = endFrame.origin.y < screenHeight

    let state = extractKeyboardState(from: userInfo, isVisible: isVisible, isAnimating: true)
    publishStateToJS(state)
  }

  // MARK: - State Extraction

  private func extractKeyboardState(
    from userInfo: [AnyHashable: Any], isVisible: Bool, isAnimating: Bool
  ) -> KeyboardState {
    let endFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect ?? .zero
    let duration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
    let curveRaw = userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7

    let screenHeight = UIScreen.main.bounds.height
    let keyboardHeight = isVisible ? (screenHeight - endFrame.origin.y) : 0

    // Convert animation curve to easing name
    let easing = curveToEasing(curveRaw)

    return KeyboardState(
      isVisible: isVisible,
      height: keyboardHeight,
      screenY: endFrame.origin.y,
      duration: duration,
      easing: easing,
      isAnimating: isAnimating
    )
  }

  func getInitialState() -> KeyboardState {
    return lastState ?? defaultState
  }

  private func curveToEasing(_ curve: UInt) -> String {
    // UIViewAnimationCurve values:
    // 0 = easeInOut, 1 = easeIn, 2 = easeOut, 3 = linear, 7 = keyboard
    switch curve {
    case 0: return "easeInOut"
    case 1: return "easeIn"
    case 2: return "easeOut"
    case 3: return "linear"
    default: return "keyboard"  // iOS keyboard uses curve 7
    }
  }

  // MARK: - Publish to JS

  private func publishStateToJS(_ state: KeyboardState) {
    guard let runtime = runtime else { return }

    // Skip if unchanged
    if let last = lastState, last == state {
      return
    }

    lastState = state
    runtime.emitEvent(name: "RuneKeyboard:change", payload: state.toDictionary())
  }
}

// MARK: - Data Models

struct KeyboardState: Equatable {
  let isVisible: Bool
  let height: CGFloat
  let screenY: CGFloat
  let duration: Double
  let easing: String
  let isAnimating: Bool

  func toDictionary() -> [String: Any] {
    [
      "isVisible": isVisible,
      "height": height,
      "screenY": screenY,
      "duration": duration,
      "easing": easing,
      "isAnimating": isAnimating,
    ]
  }
}
