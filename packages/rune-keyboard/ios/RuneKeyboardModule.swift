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
  private var pendingUpdate: Bool = false

  // MARK: - Lifecycle

  init(runtime: RuneRuntime) {
    self.runtime = runtime
    super.init()
  }

  @discardableResult
  @objc public static func initialize(with runtime: RuneRuntime) -> RuneKeyboardModule {
    print("[RuneKeyboard] Initializing module")
    let module = RuneKeyboardModule(runtime: runtime)
    print("[RuneKeyboard] Installing JS interface")
    module.installJSInterface()
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

  // MARK: - JS Interface

  private func installJSInterface() {
    guard let runtime = runtime else { return }

    // Install the native module interface with initial state
    let code = """
      (function() {
        const listeners = [];
        let currentState = {
          isVisible: false,
          height: 0,
          screenY: 0,
          duration: 0,
          easing: 'keyboard'
        };
        
        globalThis.__RUNE_KEYBOARD__ = {
          getState: function() {
            return currentState;
          },
          isVisible: function() {
            return currentState.isVisible;
          },
          getHeight: function() {
            return currentState.height;
          },
          addChangeListener: function(listener) {
            listeners.push(listener);
            return function() {
              const index = listeners.indexOf(listener);
              if (index >= 0) {
                listeners.splice(index, 1);
              }
            };
          },
          dismiss: function() {
            console.log('[RuneKeyboard][JS] dismiss() calling native via __modules');
            // Use the __modules bridge to call native dismiss
            if (globalThis.__modules && typeof globalThis.__modules.call === 'function') {
              globalThis.__modules.call('RuneKeyboard', 'dismiss', {});
            } else {
              console.warn('[RuneKeyboard] __modules bridge not available');
            }
          },
          _updateState: function(state) {
            currentState = state;
            for (let i = 0; i < listeners.length; i++) {
              try {
                listeners[i](state);
              } catch (error) {
                console.error('[RuneKeyboard] Listener error:', error);
              }
            }
          }
        };
        
        console.log('[RuneKeyboard] Module installed');
      })();
      """

    evaluateJavaScript(code, in: runtime)
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

    let stateJSON = state.toJSON()
    print("[RuneKeyboard] Publishing state to JS: \(stateJSON)")

    let code = """
      (function() {
        if (globalThis.__RUNE_KEYBOARD__) {
          globalThis.__RUNE_KEYBOARD__._updateState(\(stateJSON));
        }
      })();
      """

    evaluateJavaScript(code, in: runtime)
  }

  // MARK: - Helper to evaluate JavaScript

  /// Dedicated queue for JS evaluation to avoid deadlock with Hermes's internal dispatch_sync
  private static let jsEvalQueue = DispatchQueue(
    label: "dev.rune.keyboard.jseval", qos: .userInteractive)

  private func evaluateJavaScript(_ code: String, in runtime: RuneRuntime) {
    let mirror = Mirror(reflecting: runtime)
    for child in mirror.children {
      if child.label == "runtime", let runtimeAdapter = child.value as? JSRuntimeAdapter {
        // Dispatch to a dedicated background queue to avoid deadlock.
        // HermesRuntimeHost.evaluateString uses dispatch_sync to its JS queue.
        // If we're on main thread during a keyboard notification, and the JS queue
        // is waiting for main thread, we get a deadlock.
        // By dispatching to a separate background queue, we ensure the sync dispatch
        // to the JS queue doesn't block the main thread.
        RuneKeyboardModule.jsEvalQueue.async {
          runtimeAdapter.evaluate(code: code)
        }
        return
      }
    }
  }
}

// MARK: - Data Models

private struct KeyboardState: Equatable {
  let isVisible: Bool
  let height: CGFloat
  let screenY: CGFloat
  let duration: Double
  let easing: String
  let isAnimating: Bool

  func toJSON() -> String {
    """
    {
      "isVisible": \(isVisible),
      "height": \(height),
      "screenY": \(screenY),
      "duration": \(duration),
      "easing": "\(easing)",
      "isAnimating": \(isAnimating)
    }
    """
  }
}
