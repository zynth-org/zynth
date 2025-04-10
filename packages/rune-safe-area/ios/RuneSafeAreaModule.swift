//
//  RuneSafeAreaModule.swift
//  RuneSafeArea
//
//  Monitors UIWindow safe area insets and exposes them to JavaScript
//

import UIKit
import RuneKit

@objc(RuneSafeAreaModule)
public class RuneSafeAreaModule: NSObject {
  
  private weak var runtime: RuneRuntime?
  private var observers: [NSObjectProtocol] = []
  private var lastMetrics: WindowMetrics?
  private var pendingUpdate: Bool = false
  
  // MARK: - Lifecycle
  
  init(runtime: RuneRuntime) {
    self.runtime = runtime
    super.init()
  }
  
  @objc public static func initialize(with runtime: RuneRuntime) {
    print("[RuneSafeArea] Initializing module")
    let module = RuneSafeAreaModule(runtime: runtime)
    print("[RuneSafeArea] Installing JS interface")
    module.installJSInterface()
    print("[RuneSafeArea] Starting observation")
    module.startObserving()
    print("[RuneSafeArea] Module initialized and observing")
  }
  
  deinit {
    stopObserving()
  }
  
  // MARK: - JS Interface
  
  private func installJSInterface() {
    guard let runtime = runtime else { return }
    
    // Install the native module interface
    let code = """
    (function() {
      const listeners = [];
      let currentMetrics = null;
      
      globalThis.__RUNE_SAFE_AREA__ = {
        getInitialMetrics: function() {
          return currentMetrics;
        },
        addMetricsChangeListener: function(listener) {
          listeners.push(listener);
          return function() {
            const index = listeners.indexOf(listener);
            if (index >= 0) {
              listeners.splice(index, 1);
            }
          };
        },
        _updateMetrics: function(metrics) {
          currentMetrics = metrics;
          for (let i = 0; i < listeners.length; i++) {
            try {
              listeners[i](metrics);
            } catch (error) {
              console.error('[RuneSafeArea] Listener error:', error);
            }
          }
        }
      };
      
      console.log('[RuneSafeArea] Module installed');
    })();
    """
    
    evaluateJavaScript(code, in: runtime)
    
    // Provide initial metrics immediately
    updateMetrics(force: true)
  }
  
  // MARK: - Observation
  
  private func startObserving() {
    // Observe when window becomes key (this is the right event!)
    let windowDidBecomeKeyObserver = NotificationCenter.default.addObserver(
      forName: UIWindow.didBecomeKeyNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      print("[RuneSafeArea] Window became key - updating metrics")
      self?.scheduleMetricsUpdate()
    }
    observers.append(windowDidBecomeKeyObserver)
    
    // Observe window scene changes
    let sceneObserver = NotificationCenter.default.addObserver(
      forName: UIScene.didActivateNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      print("[RuneSafeArea] Scene activated - updating metrics")
      self?.scheduleMetricsUpdate()
    }
    observers.append(sceneObserver)
    
    // Observe orientation changes
    let orientationObserver = NotificationCenter.default.addObserver(
      forName: UIDevice.orientationDidChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      print("[RuneSafeArea] Orientation changed - updating metrics")
      self?.scheduleMetricsUpdate()
    }
    observers.append(orientationObserver)
    
    // Observe window geometry changes (replaces deprecated didChangeStatusBarFrameNotification)
    if #available(iOS 13.0, *) {
      let sceneGeometryObserver = NotificationCenter.default.addObserver(
        forName: UIScene.willEnterForegroundNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        print("[RuneSafeArea] Scene entering foreground - updating metrics")
        self?.scheduleMetricsUpdate()
      }
      observers.append(sceneGeometryObserver)
    } else {
      let statusBarObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.willChangeStatusBarFrameNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        print("[RuneSafeArea] Status bar frame changing - updating metrics")
        self?.scheduleMetricsUpdate()
      }
      observers.append(statusBarObserver)
    }
    
    // Get initial metrics immediately if window is already available
    scheduleMetricsUpdate()
  }
  
  private func stopObserving() {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
  }
  
  // MARK: - Metrics Calculation
  
  private func getCurrentMetrics() -> WindowMetrics? {
    guard let window = getActiveWindow() else {
      print("[RuneSafeArea] No active window found")
      return nil
    }
    
    let safeAreaInsets = window.safeAreaInsets
    let bounds = window.bounds
    print("[RuneSafeArea] Window found - bounds: \(bounds), safe insets: \(safeAreaInsets)")
    
    // Calculate safe frame
    let safeFrame = CGRect(
      x: safeAreaInsets.left,
      y: safeAreaInsets.top,
      width: bounds.width - safeAreaInsets.left - safeAreaInsets.right,
      height: bounds.height - safeAreaInsets.top - safeAreaInsets.bottom
    )
    
    return WindowMetrics(
      insets: SafeAreaInsets(
        top: round(safeAreaInsets.top),
        right: round(safeAreaInsets.right),
        bottom: round(safeAreaInsets.bottom),
        left: round(safeAreaInsets.left)
      ),
      frame: SafeAreaFrame(
        x: round(safeFrame.origin.x),
        y: round(safeFrame.origin.y),
        width: round(safeFrame.size.width),
        height: round(safeFrame.size.height)
      )
    )
  }
  
  private func getActiveWindow() -> UIWindow? {
    // Try to get the key window from active scene
    if #available(iOS 13.0, *) {
      // First try to get the key window from the foreground active scene
      let scenes = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
      
      // Try foreground active scene first
      if let activeScene = scenes.first(where: { $0.activationState == .foregroundActive }) {
        if let keyWindow = activeScene.windows.first(where: { $0.isKeyWindow }) {
          return keyWindow
        }
        // Fall back to first window in active scene
        if let firstWindow = activeScene.windows.first {
          return firstWindow
        }
      }
      
      // Fall back to any scene's first window
      if let window = scenes.first?.windows.first {
        return window
      }
    } else {
      // iOS 12 and earlier
      if let keyWindow = UIApplication.shared.keyWindow {
        return keyWindow
      }
      // Fall back to first window
      return UIApplication.shared.windows.first
    }
    
    return nil
  }
  
  // MARK: - Update Pipeline (Coalesced)
  
  private func scheduleMetricsUpdate() {
    guard !pendingUpdate else { return }
    pendingUpdate = true
    
    // Coalesce updates to next animation frame
    DispatchQueue.main.async { [weak self] in
      self?.pendingUpdate = false
      self?.updateMetrics(force: false)
    }
  }
  
  private func updateMetrics(force: Bool) {
    guard let newMetrics = getCurrentMetrics() else {
      print("[RuneSafeArea] Failed to get current metrics - no active window?")
      return
    }
    
    // Skip if unchanged (unless forced)
    if !force, let last = lastMetrics, last == newMetrics {
      print("[RuneSafeArea] Metrics unchanged, skipping update")
      return
    }
    
    print("[RuneSafeArea] Metrics changed or forced update. New insets: top=\(newMetrics.insets.top) right=\(newMetrics.insets.right) bottom=\(newMetrics.insets.bottom) left=\(newMetrics.insets.left)")
    lastMetrics = newMetrics
    publishMetricsToJS(newMetrics)
  }
  
  private func publishMetricsToJS(_ metrics: WindowMetrics) {
    guard let runtime = runtime else { return }
    
    let metricsJSON = metrics.toJSON()
    print("[RuneSafeArea] Publishing metrics to JS:", metricsJSON)
    let code = """
    (function() {
      if (globalThis.__RUNE_SAFE_AREA__) {
        globalThis.__RUNE_SAFE_AREA__._updateMetrics(\(metricsJSON));
        console.log('[RuneSafeArea] Metrics updated:', JSON.stringify(\(metricsJSON)));
      } else {
        console.warn('[RuneSafeArea] Module not installed, cannot update metrics');
      }
    })();
    """
    
    evaluateJavaScript(code, in: runtime)
  }
  
  // MARK: - Helper to evaluate JavaScript
  
  private func evaluateJavaScript(_ code: String, in runtime: RuneRuntime) {
    // Access the internal runtime via reflection
    // RuneRuntime.runtime is internal, so we use Mirror to access it
    let mirror = Mirror(reflecting: runtime)
    for child in mirror.children {
      if child.label == "runtime", let runtimeAdapter = child.value as? JSRuntimeAdapter {
        runtimeAdapter.evaluate(code: code)
        return
      }
    }
  }
}

// MARK: - Data Models

private struct WindowMetrics: Equatable {
  let insets: SafeAreaInsets
  let frame: SafeAreaFrame
  
  func toJSON() -> String {
    """
    {
      "insets": \(insets.toJSON()),
      "frame": \(frame.toJSON())
    }
    """
  }
}

private struct SafeAreaInsets: Equatable {
  let top: CGFloat
  let right: CGFloat
  let bottom: CGFloat
  let left: CGFloat
  
  func toJSON() -> String {
    """
    {
      "top": \(top),
      "right": \(right),
      "bottom": \(bottom),
      "left": \(left)
    }
    """
  }
}

private struct SafeAreaFrame: Equatable {
  let x: CGFloat
  let y: CGFloat
  let width: CGFloat
  let height: CGFloat
  
  func toJSON() -> String {
    """
    {
      "x": \(x),
      "y": \(y),
      "width": \(width),
      "height": \(height)
    }
    """
  }
}

// MARK: - Helper for rounding

private func round(_ value: CGFloat) -> CGFloat {
  return Darwin.round(value)
}
