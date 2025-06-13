import UIKit
import RuneKit

@objcMembers
@objc(RNStackController)
public final class RNStackController: UIViewController, UINavigationControllerDelegate,
  UIGestureRecognizerDelegate, UINavigationBarDelegate, UIBarPositioningDelegate
{
  private let navigator = UINavigationController()
  private let fallbackSurfaceHost = UIView()
  private var routeStack: [RouteRecord] = []
  private weak var routerModule: RuneRouterModule?
  private var emitter: RuneRouterEmitter?
  weak var runtime: RuneRuntime? {
    didSet {
      guard let runtime else { return }
      for record in routeStack {
        record.controller?.attachRuntime(runtime)
      }
    }
  }
  private var focusedRouteKey: String?
  private var transitionRouteKey: String?
  private var transitionDisplayLink: CADisplayLink?
  private weak var transitionCoordinatorRef: UIViewControllerTransitionCoordinator?
  private weak var hostedSurface: UIView?
  private weak var activeHost: RNScreenHostController?
  private var routerActive = false
  private var stackKey: String = "stack-root"
  private var lastEmittedStateJSON: String?
  private var pendingActions: [(RNStackController) -> Void] = []

  public override func viewDidLoad() {
    super.viewDidLoad()
    navigator.delegate = self
    navigator.view.frame = view.bounds
    navigator.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(navigator.view)
    fallbackSurfaceHost.frame = view.bounds
    fallbackSurfaceHost.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    fallbackSurfaceHost.backgroundColor = UIColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1.0)
    view.addSubview(fallbackSurfaceHost)
    configureNavigationAppearance()
    navigator.interactivePopGestureRecognizer?.delegate = self
    navigator.interactivePopGestureRecognizer?.addTarget(self, action: #selector(handleEdgePan(_:)))
    setRouterActive(false)
  }

  func bindRouterModule(_ module: RuneRouterModule, emitter: RuneRouterEmitter) {
    routerModule = module
    self.emitter = emitter
    for record in routeStack {
      record.controller?.attachEmitter(emitter)
    }
  }

  func installRootSurface(_ surface: UIView) {
    loadViewIfNeeded()
    hostedSurface = surface
    surface.removeFromSuperview()
    attachSurfaceToFallbackHost()
    // Don't create any initial route - let JS dispatch RESET to initialize
  }  // MARK: - Navigation commands

  func push(routeName: String, params: [String: Any]?, animated: Bool) {
    scheduleNavigationAction { controller in
      controller.performPush(routeName: routeName, params: params, animated: animated)
    }
  }

  private func performPush(routeName: String, params: [String: Any]?, animated: Bool) {
    let record = RouteRecord(name: routeName, params: params)
    let host = RNScreenHostController(routeKey: record.key, routeName: routeName, params: params)
    if let runtime {
      host.attachRuntime(runtime)
    }
    if let emitter {
      host.attachEmitter(emitter)
    }
    record.controller = host
    routeStack.append(record)
    navigator.pushViewController(host, animated: animated)
    emitStateChanged()
  }

  func pop(count: Int, animated: Bool) {
    scheduleNavigationAction { controller in
      controller.performPop(count: count, animated: animated)
    }
  }

  private func performPop(count: Int, animated: Bool) {
    guard !routeStack.isEmpty else { return }
    let targetCount = routeStack.count - count
    if targetCount > 0 {
      routeStack.removeLast(count)
    } else {
      routeStack.removeAll()
    }

    if count <= 1 {
      navigator.popViewController(animated: animated)
    } else {
      let controllerCount = navigator.viewControllers.count
      let targetIndex = max(controllerCount - count - 1, 0)
      guard targetIndex < controllerCount,
        targetIndex < navigator.viewControllers.count
      else {
        navigator.popToRootViewController(animated: animated)
        emitStateChanged()
        return
      }
      let target = navigator.viewControllers[targetIndex]
      navigator.popToViewController(target, animated: animated)
    }
    emitStateChanged()
  }

  func replaceTop(with name: String, params: [String: Any]?, animated: Bool) {
    scheduleNavigationAction { controller in
      controller.performReplaceTop(with: name, params: params, animated: animated)
    }
  }

  private func performReplaceTop(with name: String, params: [String: Any]?, animated: Bool) {
    guard !routeStack.isEmpty else {
      return
    }
    routeStack.removeLast()
    _ = navigator.popViewController(animated: false)
    performPush(routeName: name, params: params, animated: animated)
    // emitStateChanged is called by push()
  }

  func reset(using state: [String: Any], animated: Bool) {
    scheduleNavigationAction { controller in
      controller.performReset(using: state, animated: animated)
    }
  }

  private func performReset(using state: [String: Any], animated: Bool) {
    guard let routes = state["routes"] as? [[String: Any]] else { return }

    // Store the stack key from JS if provided
    if let jsStackKey = state["key"] as? String {
      stackKey = jsStackKey
    }

    var records: [RouteRecord] = []
    var controllers: [UIViewController] = []
    for route in routes {
      guard let name = route["name"] as? String else { continue }
      let params = route["params"] as? [String: Any]
      let key = (route["key"] as? String) ?? UUID().uuidString
      let record = RouteRecord(name: name, params: params, key: key)
      let host = RNScreenHostController(routeKey: record.key, routeName: name, params: params)
      if let runtime {
        host.attachRuntime(runtime)
      }
      if let emitter {
        host.attachEmitter(emitter)
      }
      record.controller = host
      records.append(record)
      controllers.append(host)
    }
    routeStack = records
    navigator.setViewControllers(controllers, animated: animated)
    if let activeHost = controllers.last as? RNScreenHostController {
      setRouterActive(true)
      attachSurface(to: activeHost)
    } else {
      setRouterActive(false)
    }
    emitStateChanged()
  }

  func setParams(for key: String, params: [String: Any]) {
    guard let record = routeStack.first(where: { $0.key == key }) else { return }
    var merged = record.params ?? [:]
    for (paramKey, value) in params {
      merged[paramKey] = value
    }
    record.params = merged
    record.controller?.updateParams(merged)
    emitStateChanged()
  }

  func applyOptions(for key: String, options: [String: Any]) {
    guard let record = routeStack.first(where: { $0.key == key }) else { return }
    var next = record.options ?? [:]
    mergeOptions(into: &next, patch: options)
    record.options = next
    record.controller?.apply(options: next)
  }

  func configureTabs(for routeKey: String, configuration: TabBarConfiguration) {
    guard let host = controller(for: routeKey) else { return }
    host.configureTabs(configuration: configuration) { [weak self] tabName in
      self?.emitter?.emitTabSelection(
        navigatorId: configuration.navigatorId,
        tabName: tabName
      )
    }
  }

  func removeTabs(for routeKey: String) {
    controller(for: routeKey)?.removeTabs()
  }

  func selectTab(for routeKey: String, name: String) {
    controller(for: routeKey)?.selectTab(named: name)
  }

  // MARK: - State + events

  func currentStatePayload() -> [String: Any] {
    let routes = routeStack.map { $0.asDictionary() }
    return [
      "key": stackKey,
      "type": "stack",
      "index": max(routes.count - 1, 0),
      "routes": routes,
    ]
  }

  private func emitStateChanged() {
    updateRouterActivationState()
    guard let emitter else { return }
    let payload = currentStatePayload()
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8),
      json == lastEmittedStateJSON
    {
      return
    } else if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8)
    {
      lastEmittedStateJSON = json
    }

    emitter.emitState(payload)
    updateRouteFocusState()
  }

  private func updateRouteFocusState() {
    guard let emitter else { return }
    guard let newFocused = routeStack.last?.key else { return }
    if focusedRouteKey == newFocused {
      return
    }
    if let previous = focusedRouteKey {
      emitter.emitBlur(key: previous)
    }
    emitter.emitFocus(key: newFocused)
    focusedRouteKey = newFocused
  }

  // MARK: - UINavigationControllerDelegate

  public func navigationController(
    _ navigationController: UINavigationController,
    willShow viewController: UIViewController,
    animated: Bool
  ) {
    guard let host = viewController as? RNScreenHostController else {
      transitionRouteKey = nil
      return
    }
    attachSurface(to: host)
    // Update route stack to match navigation controller state (for back button)
    let currentKeys = Set(
      navigationController.viewControllers.compactMap { ($0 as? RNScreenHostController)?.routeKey })
    routeStack.removeAll { record in
      !currentKeys.contains(record.key)
    }
    emitStateChanged()

    transitionRouteKey = host.routeKey
    emitter?.emitTransitionStart(key: host.routeKey, progress: 0)

    if let coordinator = navigationController.transitionCoordinator {
      transitionCoordinatorRef = coordinator
      coordinator.notifyWhenInteractionEnds { [weak self] context in
        self?.finishTransition(finished: !context.isCancelled)
      }
      coordinator.notifyWhenInteractionChanges { [weak self] context in
        if !context.isInteractive {
          self?.finishTransition(finished: !context.isCancelled)
        }
      }
      startTransitionDisplayLink()
    } else {
      finishTransition(finished: true)
    }
  }

  public func navigationController(
    _ navigationController: UINavigationController,
    didShow viewController: UIViewController,
    animated: Bool
  ) {
    if let host = viewController as? RNScreenHostController {
      attachSurface(to: host)
    }
    trimRouteStack()
    emitStateChanged()
    finishTransition(finished: true)
  }

  // MARK: - UIGestureRecognizerDelegate + predictive back

  public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard gestureRecognizer === navigator.interactivePopGestureRecognizer else {
      return true
    }
    guard routeStack.count > 1, let key = routeStack.last?.key else { return false }
    return confirmBeforeRemoving(routeKey: key)
  }

  @objc
  private func handleEdgePan(_ gesture: UIPanGestureRecognizer) {
    guard
      let view = gesture.view,
      let key = routeStack.last?.key
    else { return }

    let translation = gesture.translation(in: view)
    let progress = max(0, min(1, translation.x / view.bounds.width))

    switch gesture.state {
    case .began, .changed:
      emitter?.emitTransitionProgress(key: key, progress: progress)
      emitter?.emitPredictiveBack(key: key, progress: progress, velocity: nil)
    case .ended, .cancelled:
      let velocity = gesture.velocity(in: view).x / view.bounds.width
      emitter?.emitPredictiveBack(
        key: key,
        progress: progress,
        velocity: Double(velocity)
      )
    default:
      break
    }
  }

  // MARK: - UINavigationBarDelegate

  public func navigationBar(_ navigationBar: UINavigationBar, shouldPop item: UINavigationItem)
    -> Bool
  {
    guard routeStack.count > 1, let key = routeStack.last?.key else { return true }
    let allowed = confirmBeforeRemoving(routeKey: key)
    if allowed {
      DispatchQueue.main.async { [weak self] in
        self?.navigator.popViewController(animated: true)
      }
    } else {
      resetNavigationBarLayout()
    }
    return false
  }

  public func position(for bar: UIBarPositioning) -> UIBarPosition {
    return .topAttached
  }

  private func resetNavigationBarLayout() {
    for subview in navigator.navigationBar.subviews {
      if subview.alpha < 1.0 {
        UIView.animate(withDuration: 0.25) {
          subview.alpha = 1.0
        }
      }
    }
  }

  // MARK: - Before remove confirmation

  private func confirmBeforeRemoving(routeKey: String) -> Bool {
    guard let routerModule else { return true }
    let semaphore = DispatchSemaphore(value: 0)
    var allow = true
    let action: [String: Any] = [
      "type": "POP",
      "source": routeKey,
    ]
    routerModule.requestBeforeRemove(for: routeKey, action: action) { result in
      allow = result
      semaphore.signal()
    }
    let timeout = DispatchTime.now() + .milliseconds(250)
    if semaphore.wait(timeout: timeout) == .timedOut {
      return true
    }
    return allow
  }

  // MARK: - Transition tracking

  private func startTransitionDisplayLink() {
    transitionDisplayLink?.invalidate()
    guard transitionCoordinatorRef != nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(stepTransition))
    link.add(to: .main, forMode: .common)
    transitionDisplayLink = link
  }

  @objc
  private func stepTransition() {
    guard
      let coordinator = transitionCoordinatorRef,
      let key = transitionRouteKey
    else {
      transitionDisplayLink?.invalidate()
      transitionDisplayLink = nil
      return
    }
    let progress = Double(coordinator.percentComplete)
    emitter?.emitTransitionProgress(key: key, progress: progress)
    if coordinator.isInteractive {
      emitter?.emitPredictiveBack(key: key, progress: progress, velocity: nil)
    }
  }

  private func finishTransition(finished: Bool) {
    transitionDisplayLink?.invalidate()
    transitionDisplayLink = nil
    transitionCoordinatorRef = nil
    let key = transitionRouteKey
    transitionRouteKey = nil
    if let key {
      emitter?.emitTransitionEnd(key: key, finished: finished)
    }
    for record in routeStack {
      record.controller?.clearSnapshot()
    }
    flushPendingActionsIfPossible()
  }

  private func attachSurface(to host: RNScreenHostController) {
    guard let surface = hostedSurface else { return }
    if activeHost === host, surface.superview === host.view {
      return
    }
    if activeHost !== host {
      activeHost?.captureSnapshot()
    }
    surface.removeFromSuperview()
    host.attachSurfaceView(surface)
    activeHost = host
  }

  private func attachSurfaceToFallbackHost() {
    guard let surface = hostedSurface else { return }
    loadViewIfNeeded()
    if surface.superview === fallbackSurfaceHost {
      return
    }
    activeHost = nil
    surface.removeFromSuperview()
    surface.frame = fallbackSurfaceHost.bounds
    surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    fallbackSurfaceHost.addSubview(surface)
  }

  private func setRouterActive(_ active: Bool) {
    if routerActive == active {
      updateHostVisibility(active: active)
      if !active {
        attachSurfaceToFallbackHost()
      }
      return
    }
    routerActive = active
    updateHostVisibility(active: active)
    if !active {
      attachSurfaceToFallbackHost()
    }
  }

  private func updateRouterActivationState() {
    setRouterActive(!routeStack.isEmpty)
  }

  private func updateHostVisibility(active: Bool) {
    loadViewIfNeeded()
    navigator.view.isHidden = !active
    navigator.view.isUserInteractionEnabled = active
    fallbackSurfaceHost.isHidden = active
    fallbackSurfaceHost.isUserInteractionEnabled = !active
    if active {
      view.bringSubviewToFront(navigator.view)
    } else {
      view.bringSubviewToFront(fallbackSurfaceHost)
    }
  }

  private func configureNavigationAppearance() {
    let backgroundColor = UIColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1.0)
    let titleColor = UIColor.white
    if #available(iOS 13.0, *) {
      let appearance = UINavigationBarAppearance()
      appearance.configureWithTransparentBackground()
      appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialDark)
      appearance.backgroundColor = backgroundColor.withAlphaComponent(0.65)
      appearance.shadowColor = nil
      appearance.titleTextAttributes = [.foregroundColor: titleColor]
      appearance.largeTitleTextAttributes = [.foregroundColor: titleColor]
      navigator.navigationBar.standardAppearance = appearance
      navigator.navigationBar.scrollEdgeAppearance = appearance
      navigator.navigationBar.compactAppearance = appearance
    } else {
      navigator.navigationBar.barTintColor = backgroundColor.withAlphaComponent(0.65)
      navigator.navigationBar.isTranslucent = true
      navigator.navigationBar.titleTextAttributes = [.foregroundColor: titleColor]
      if navigator.navigationBar.subviews.first(where: { $0 is UIVisualEffectView }) == nil {
        let blurView = UIVisualEffectView(effect: UIBlurEffect(style: .dark))
        blurView.frame = navigator.navigationBar.bounds
        blurView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        navigator.navigationBar.insertSubview(blurView, at: 0)
      }
    }
    navigator.navigationBar.tintColor = titleColor
    navigator.navigationBar.barStyle = .black
  }

  private func trimRouteStack() {
    let keys = Set(
      navigator.viewControllers.compactMap { ($0 as? RNScreenHostController)?.routeKey }
    )
    routeStack.removeAll { record in
      guard let controller = record.controller else { return true }
      return !keys.contains(controller.routeKey)
    }
  }

  private func controller(for routeKey: String) -> RNScreenHostController? {
    return routeStack.first(where: { $0.key == routeKey })?.controller
  }

  private func scheduleNavigationAction(_ action: @escaping (RNStackController) -> Void) {
    if isTransitionInFlight {
      pendingActions.append(action)
    } else {
      action(self)
    }
  }

  private func flushPendingActionsIfPossible() {
    guard !pendingActions.isEmpty else { return }
    while !pendingActions.isEmpty && !isTransitionInFlight {
      let next = pendingActions.removeFirst()
      next(self)
    }
  }

  private var isTransitionInFlight: Bool {
    return transitionCoordinatorRef != nil || navigator.transitionCoordinator != nil
  }
}

// MARK: - Route record

private final class RouteRecord {
  let key: String
  let name: String
  var params: [String: Any]?
  var options: [String: Any]?
  weak var controller: RNScreenHostController?

  init(name: String, params: [String: Any]?, key: String = UUID().uuidString) {
    self.name = name
    self.params = params
    self.key = key
  }

  func asDictionary() -> [String: Any] {
    var result: [String: Any] = [
      "key": key,
      "name": name,
    ]
    if let params {
      result["params"] = params
    }
    return result
  }
}

private func mergeOptions(into target: inout [String: Any], patch: [String: Any]) {
  for (key, value) in patch {
    if value is NSNull {
      target.removeValue(forKey: key)
    } else {
      target[key] = value
    }
  }
}
