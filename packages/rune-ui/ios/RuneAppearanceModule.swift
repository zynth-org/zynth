//
//  RuneAppearanceModule.swift
//  RuneUI
//
//  Native module implementation for system appearance.
//

import RuneKit
import UIKit

@objc(RuneAppearanceModule)
public class RuneAppearanceModule: NSObject {

  private weak var runtime: RuneRuntime?
  private var observers: [NSObjectProtocol] = []
  private var traitObserver: TraitObserverView?
  private var lastState: AppearanceState?
  private var pendingUpdate: Bool = false
  private var surfaceId: Int?
  private var firstFrameListener: (() -> Void)?

  struct AppearanceState: Equatable {
    let colorScheme: String

    func toDictionary() -> [String: Any] {
      [
        "colorScheme": colorScheme
      ]
    }
  }

  init(runtime: RuneRuntime) {
    self.runtime = runtime
    super.init()
  }

  @discardableResult
  @objc public static func initialize(with runtime: RuneRuntime) -> RuneAppearanceModule {
    print("[RuneAppearance] initialize")
    let module = RuneAppearanceModule(runtime: runtime)
    module.registerBridge()
    module.startObserving()
    return module
  }

  deinit {
    stopObserving()
  }

  private func registerBridge() {
    guard let runtime = runtime else { return }
    print("[RuneAppearance] registerBridge")
    let bridge = RuneAppearanceBridge(module: self)
    runtime.installModules([bridge])
  }

  private func startObserving() {
    print("[RuneAppearance] startObserving")
    let windowDidBecomeKeyObserver = NotificationCenter.default.addObserver(
      forName: UIWindow.didBecomeKeyNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.attachTraitObserverIfNeeded()
      self?.scheduleAppearanceUpdate()
    }
    observers.append(windowDidBecomeKeyObserver)

    if #available(iOS 13.0, *) {
      let sceneObserver = NotificationCenter.default.addObserver(
        forName: UIScene.didActivateNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.attachTraitObserverIfNeeded()
        self?.scheduleAppearanceUpdate()
      }
      observers.append(sceneObserver)
    }

    let didBecomeActive = NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.attachTraitObserverIfNeeded()
      self?.scheduleAppearanceUpdate()
    }

    let willEnterForeground = NotificationCenter.default.addObserver(
      forName: UIApplication.willEnterForegroundNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.attachTraitObserverIfNeeded()
      self?.scheduleAppearanceUpdate()
    }

    observers.append(didBecomeActive)
    observers.append(willEnterForeground)

    attachTraitObserverIfNeeded()
    scheduleAppearanceUpdate()
    registerFirstFrameListenerIfNeeded()
  }

  private func stopObserving() {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
    detachTraitObserver()
    removeFirstFrameListener()
  }

  func getInitialState() -> AppearanceState {
    return lastState ?? getCurrentState()
  }

  func getCurrentState() -> AppearanceState {
    AppearanceState(colorScheme: resolveColorScheme())
  }

  private func resolveColorScheme() -> String {
    if #available(iOS 13.0, *) {
      let style = currentTraitCollection().userInterfaceStyle
      switch style {
      case .dark:
        return "dark"
      default:
        return "light"
      }
    }
    return "light"
  }

  private func updateState(force: Bool) {
    let newState = getCurrentState()
    if !force, let last = lastState, last == newState {
      return
    }
    print("[RuneAppearance] updateState colorScheme=\(newState.colorScheme)")
    lastState = newState
    publishState(newState)
  }

  private func publishState(_ state: AppearanceState) {
    guard let runtime = runtime else { return }
    print("[RuneAppearance] emit RuneAppearance:change \(state.toDictionary())")
    runtime.emitEvent(name: "RuneAppearance:change", payload: state.toDictionary())
  }

  private func currentTraitCollection() -> UITraitCollection {
    if let window = getActiveWindow() {
      return window.traitCollection
    }
    return UIScreen.main.traitCollection
  }

  private func attachTraitObserverIfNeeded() {
    guard let window = getActiveWindow() else { return }
    if let existing = traitObserver, existing.window === window {
      return
    }

    traitObserver?.removeFromSuperview()

    let observer = TraitObserverView()
    observer.onChange = { [weak self] in
      self?.updateState(force: false)
    }
    observer.isHidden = true
    observer.frame = .zero

    window.addSubview(observer)
    traitObserver = observer
  }

  private func detachTraitObserver() {
    traitObserver?.removeFromSuperview()
    traitObserver = nil
  }

  private func scheduleAppearanceUpdate() {
    guard !pendingUpdate else { return }
    pendingUpdate = true
    DispatchQueue.main.async { [weak self] in
      self?.pendingUpdate = false
      self?.updateState(force: false)
    }
  }

  private func registerFirstFrameListenerIfNeeded() {
    guard let runtime = runtime else { return }
    guard firstFrameListener == nil else { return }
    let rootId = runtime.rootSurfaceId
    surfaceId = rootId
    let listener: () -> Void = { [weak self] in
      self?.updateState(force: true)
    }
    firstFrameListener = listener
    runtime.addSurfaceFirstFrameListener(rootId, listener: listener)
  }

  private func removeFirstFrameListener() {
    guard let runtime = runtime, let rootId = surfaceId, let listener = firstFrameListener else {
      return
    }
    runtime.removeSurfaceFirstFrameListener(rootId, listener: listener)
    firstFrameListener = nil
    surfaceId = nil
  }

  private func getActiveWindow() -> UIWindow? {
    if #available(iOS 13.0, *) {
      return UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .first { $0.activationState == .foregroundActive }?
        .windows
        .first { $0.isKeyWindow }
    }
    return UIApplication.shared.keyWindow
  }
}

private final class TraitObserverView: UIView {
  var onChange: (() -> Void)?

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    guard #available(iOS 13.0, *) else { return }
    let previous = previousTraitCollection?.userInterfaceStyle
    let current = traitCollection.userInterfaceStyle
    if previous != current {
      print("[RuneAppearance] traitCollectionDidChange \(String(describing: previous)) -> \(current)")
      onChange?()
    }
  }
}

final class RuneAppearanceBridge: NSObject, RuneModule, RuneSyncModule {

  let name = "RuneAppearance"
  // Strong reference to keep the module alive since the bridge is retained by the runtime
  private var module: RuneAppearanceModule?

  init(module: RuneAppearanceModule) {
    self.module = module
    super.init()
  }

  var constantsToExport: [String: Any]? {
    print("[RuneAppearance] constantsToExport")
    return module?.getInitialState().toDictionary()
  }

  func call(method: String, args: Any?) throws -> Any? {
    switch method {
    default:
      return ["error": "unsupported_method", "message": method]
    }
  }

  func callSync(method: String, args: Any?) throws -> Any? {
    switch method {
    case "getCurrent":
      print("[RuneAppearance] callSync getCurrent")
      return module?.getCurrentState().toDictionary()
    default:
      throw RuneModuleError.syncNotSupported(module: name, method: method)
    }
  }
}
