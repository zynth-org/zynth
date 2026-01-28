//
//  ZynthSafeAreaModule.swift
//  ZynthSafeArea
//
//  Monitors UIWindow safe area insets and exposes them to JavaScript
//

import UIKit
import ZynthKit

@objc(ZynthSafeAreaModule)
public class ZynthSafeAreaModule: NSObject {
  
  private weak var runtime: ZynthRuntime?
  private var observers: [NSObjectProtocol] = []
  private var lastMetrics: WindowMetrics?
  private var pendingUpdate: Bool = false
  
  // MARK: - Lifecycle
  
  init(runtime: ZynthRuntime) {
    self.runtime = runtime
    super.init()
  }
  
  @discardableResult
  @objc public static func initialize(with runtime: ZynthRuntime) -> ZynthSafeAreaModule {
    print("[ZynthSafeArea] Initializing module")
    let module = ZynthSafeAreaModule(runtime: runtime)
    print("[ZynthSafeArea] Starting observation")
    module.start()
    print("[ZynthSafeArea] Module initialized and observing")
    return module
  }
  
  deinit {
    stopObserving()
  }
  
  // MARK: - Bridge

  func makeBridge() -> ZynthSafeAreaBridge {
    return ZynthSafeAreaBridge(module: self)
  }
  
  // MARK: - Observation
  
  func start() {
    // Observe when window becomes key (this is the right event!)
    let windowDidBecomeKeyObserver = NotificationCenter.default.addObserver(
      forName: UIWindow.didBecomeKeyNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      print("[ZynthSafeArea] Window became key - updating metrics")
      self?.scheduleMetricsUpdate()
    }
    observers.append(windowDidBecomeKeyObserver)
    
    // Observe window scene changes
    let sceneObserver = NotificationCenter.default.addObserver(
      forName: UIScene.didActivateNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      print("[ZynthSafeArea] Scene activated - updating metrics")
      self?.scheduleMetricsUpdate()
    }
    observers.append(sceneObserver)
    
    // Observe orientation changes
    let orientationObserver = NotificationCenter.default.addObserver(
      forName: UIDevice.orientationDidChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      print("[ZynthSafeArea] Orientation changed - updating metrics")
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
        print("[ZynthSafeArea] Scene entering foreground - updating metrics")
        self?.scheduleMetricsUpdate()
      }
      observers.append(sceneGeometryObserver)
    } else {
      let statusBarObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.willChangeStatusBarFrameNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        print("[ZynthSafeArea] Status bar frame changing - updating metrics")
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
      print("[ZynthSafeArea] No active window found")
      return nil
    }
    
    let safeAreaInsets = window.safeAreaInsets
    let bounds = window.bounds
    print("[ZynthSafeArea] Window found - bounds: \(bounds), safe insets: \(safeAreaInsets)")
    
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

  func getInitialMetrics() -> WindowMetrics {
    return getCurrentMetrics() ?? defaultMetrics()
  }

  func refreshMetrics() {
    print("[ZynthSafeArea] Forced refresh requested")
    updateMetrics(force: true)
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
      print("[ZynthSafeArea] Failed to get current metrics - no active window?")
      return
    }
    
    // Skip if unchanged (unless forced)
    if !force, let last = lastMetrics, last == newMetrics {
      print("[ZynthSafeArea] Metrics unchanged, skipping update")
      return
    }
    
    print("[ZynthSafeArea] Metrics changed or forced update. New insets: top=\(newMetrics.insets.top) right=\(newMetrics.insets.right) bottom=\(newMetrics.insets.bottom) left=\(newMetrics.insets.left)")
    lastMetrics = newMetrics
    publishMetricsToJS(newMetrics)
  }
  
  private func publishMetricsToJS(_ metrics: WindowMetrics) {
    guard let runtime = runtime else { return }

    runtime.emitEvent(name: "zynth.safearea.change", payload: metrics.toDictionary())
  }
}

// MARK: - Data Models

struct WindowMetrics: Equatable {
  let insets: SafeAreaInsets
  let frame: SafeAreaFrame
  
  func toDictionary() -> [String: Any] {
    [
      "insets": insets.toDictionary(),
      "frame": frame.toDictionary(),
    ]
  }
}

struct SafeAreaInsets: Equatable {
  let top: CGFloat
  let right: CGFloat
  let bottom: CGFloat
  let left: CGFloat
  
  func toDictionary() -> [String: Any] {
    [
      "top": top,
      "right": right,
      "bottom": bottom,
      "left": left,
    ]
  }
}

struct SafeAreaFrame: Equatable {
  let x: CGFloat
  let y: CGFloat
  let width: CGFloat
  let height: CGFloat
  
  func toDictionary() -> [String: Any] {
    [
      "x": x,
      "y": y,
      "width": width,
      "height": height,
    ]
  }
}

// MARK: - Helper for rounding

private func defaultMetrics() -> WindowMetrics {
  WindowMetrics(
    insets: SafeAreaInsets(top: 0, right: 0, bottom: 0, left: 0),
    frame: SafeAreaFrame(x: 0, y: 0, width: 0, height: 0)
  )
}

private func round(_ value: CGFloat) -> CGFloat {
  return Darwin.round(value)
}
