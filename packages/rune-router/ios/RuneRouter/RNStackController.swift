import QuartzCore
import RuneKit
import UIKit

@objcMembers
@objc(RNStackController)
public final class RNStackController: UIViewController, UINavigationControllerDelegate,
  UIGestureRecognizerDelegate, UINavigationBarDelegate, UIBarPositioningDelegate,
  UIAdaptivePresentationControllerDelegate
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
        ensureSurface(for: record, runtime: runtime)
      }
    }
  }
  private var focusedRouteKey: String?
  private var transitionRouteKey: String?
  private var transitionDisplayLink: CADisplayLink?
  private weak var transitionCoordinatorRef: UIViewControllerTransitionCoordinator?
  private weak var rootSurface: UIView?
  private weak var activeHost: RNScreenHostController?
  private var routerActive = false
  private var stackKey: String = "stack-root"
  private var lastEmittedStateJSON: String?
  private weak var transitioningNavigationController: UINavigationController?
  private var pendingActions: [(RNStackController) -> Void] = []
  private var lastProgressByRoute: [String: (progress: Double, timestamp: CFTimeInterval)] = [:]
  private var pendingRenderCallbacks: [Int: () -> Void] = [:]
  private var pendingTransitionTeardowns: [RouteRecord] = []

  public override func viewDidLoad() {
    super.viewDidLoad()
    navigator.delegate = self
    navigator.view.frame = view.bounds
    navigator.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]

    addChild(navigator)
    view.addSubview(navigator.view)
    navigator.didMove(toParent: self)

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

  func notifyScreenRendered(surfaceId: Int) {
    if let callback = pendingRenderCallbacks.removeValue(forKey: surfaceId) {
      callback()
    }
  }

  public func installRootSurface(_ surface: UIView) {
    loadViewIfNeeded()
    rootSurface = surface
    
    // Always dispatch to main queue async to ensure any current transaction commits are finished
    // This prevents "CA::Layer::ensure_transaction_recursively" crashes during initial layout
    DispatchQueue.main.async { [weak self] in
        self?.performInstall(surface)
    }
  }
  
  private func performInstall(_ surface: UIView) {
    surface.removeFromSuperview()
    attachSurfaceToFallbackHost()
  }

  private func attachSurfaceToFallbackHost() {
    guard let surface = rootSurface else { return }
    loadViewIfNeeded()
    
    // Always dispatch to main queue async
    DispatchQueue.main.async { [weak self] in
        self?.performAttach()
    }
  }

  private func performAttach() {
    guard let surface = rootSurface else { return }
    // Ensure superview and valid state
    surface.removeFromSuperview()
    surface.frame = fallbackSurfaceHost.bounds
    surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    fallbackSurfaceHost.addSubview(surface)
  }

  // MARK: - Navigation commands

  func push(routeName: String, params: [String: Any]?, options: [String: Any]?, animated: Bool) {
    scheduleNavigationAction { controller in
      controller.performPush(
        routeName: routeName, params: params, options: options, animated: animated)
    }
  }

  private func performPush(
    routeName: String, params: [String: Any]?, options: [String: Any]?, animated: Bool
  ) {
    // Resolve options and presentation early to know if this is a modal host.
    let staticOptions = options ?? routerModule?.getOptions(for: routeName)
    let presentation = staticOptions?["presentation"] as? String
    
    if presentation == "bottomSheet" {
        if #available(iOS 16.0, *) {
             let sheetOptions = staticOptions?["bottomSheet"] as? [String: Any]
             let sheet = RNBottomSheetController(config: sheetOptions)
             if let runtime { sheet.runtime = runtime }
             if let emitter { sheet.emitter = emitter }
             if let module = routerModule {
                 sheet.routerModule = module
                 module.registerBottomSheet(sheet)
             }
             sheet.modalPresentationStyle = .overFullScreen
             
             let record = RouteRecord(name: routeName, params: params)
             record.presentedController = sheet
             routeStack.append(record)
             emitStateChanged()
             
             let activeNav = activeNavigationController()
             activeNav.present(sheet, animated: false)
             return
        }
    }

    let isModal =
      presentation == "modal" || presentation == "fullScreen" || presentation == "formSheet"
      || presentation == "pageSheet" || presentation == "transparentModal"

    let record = RouteRecord(name: routeName, params: params)
    record.options = staticOptions
    let host = RNScreenHostController(
      routeKey: record.key,
      routeName: routeName,
      params: params,
      isModal: isModal,
      presentation: presentation
    )

    if let runtime {
      host.attachRuntime(runtime)
    }
    if let emitter {
      host.attachEmitter(emitter)
    }
    record.controller = host
    if let runtime {
      ensureSurface(for: record, runtime: runtime)
    }
    if let surface = record.surfaceView {
      host.attachSurfaceView(surface)
    }

    // Determine context before appending to avoid self-discovery
    let activeNav = activeNavigationController()
    routeStack.append(record)
    emitStateChanged()
    // Force view load to ensure surface is attached
    host.loadViewIfNeeded()
    let executePush = { [weak self, record, host, activeNav] in
      guard let self = self else { return }
      // Ensure the record is still in the stack (hasn't been popped while waiting)

      guard self.routeStack.contains(where: { $0 === record }) else { return }

      if isModal {
        let modalNav = UINavigationController(rootViewController: host)
        modalNav.delegate = self
        modalNav.modalPresentationStyle = mapPresentationStyle(presentation)
        self.configureTransparentNav(modalNav)
        modalNav.presentationController?.delegate = self
        record.presentedController = modalNav
        record.hostingNavigator = modalNav

        if activeNav === self.navigator {
          self.present(modalNav, animated: animated)
        } else {
          activeNav.present(modalNav, animated: animated)
        }
        // Hook up programmatic dismissal cleanup
        host.onDismiss = { [weak self, weak modalNav] in
          guard let modalNav else { return }
          self?.handlePresentedControllerDismissal(modalNav)
        }
      } else {
        record.hostingNavigator = activeNav
        activeNav.pushViewController(host, animated: animated)
      }
    }

    if let surfaceId = record.surfaceId {
      pendingRenderCallbacks[surfaceId] = executePush
      // Fallback timeout in case rendering is slow or fails
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
        self?.notifyScreenRendered(surfaceId: surfaceId)
      }
    } else {
      executePush()
    }

  }

  private func activeNavigationController() -> UINavigationController {
    // Find the last record that has a presented controller which is a NavController
    // If none, return self.navigator
    // We scan backwards
    for record in routeStack.reversed() {
      if let nav = record.presentedController as? UINavigationController {
        return nav
      }
      // If a record is hosted by a navigator, that doesn't mean it PRESENTS one.
      // We look for the PRESENTING record.
    }
    return navigator
  }

  func pop(count: Int, animated: Bool) {
    scheduleNavigationAction { controller in
      controller.performPop(count: count, animated: animated)
    }
  }

  private func performPop(count: Int, animated: Bool) {
    guard !routeStack.isEmpty else { return }
    let removeCount = min(count, routeStack.count)
    let startIndex = routeStack.count - removeCount

    // Check if we are removing a modal root
    var modalDismissalIndex: Int?
    for i in startIndex..<routeStack.count {
      if routeStack[i].presentedController != nil {
        modalDismissalIndex = i
        break
      }
    }

    if let index = modalDismissalIndex {
      let record = routeStack[index]
      let targetRecord = index > 0 ? routeStack[index - 1] : nil
      let targetHost = targetRecord?.controller
      let targetNavigator = targetRecord?.hostingNavigator
      let recordsToDispose = Array(routeStack[index..<routeStack.count])
      routeStack.removeSubrange(index..<routeStack.count)
      let completion: () -> Void = { [weak self, weak targetHost, weak targetNavigator] in
        guard let self else { return }
        if let host = targetHost {
          self.attachSurface(to: host)
          self.clearSnapshots(for: targetNavigator ?? self.navigator)
        }
        self.emitStateChanged()
        self.scheduleTeardown(recordsToDispose)
      }

      if animated {
        record.presentedController?.dismiss(animated: true, completion: completion)
      } else {
        record.presentedController?.dismiss(animated: false)
        completion()
      }
      return
    } else {
      // Normal pop in active navigator
      let activeNav = activeNavigationController()
      let removedRecords = Array(routeStack.suffix(removeCount))
      routeStack.removeLast(removeCount)

      if activeNav.viewControllers.count > 1 {
        if let targetRecord = routeStack.last,
          let targetVC = targetRecord.controller,
          targetRecord.hostingNavigator === activeNav
        {
          activeNav.popToViewController(targetVC, animated: animated)
        } else {
          // Fallback if target not found or stack mismatch
          if activeNav.viewControllers.count > 1 {
            activeNav.popViewController(animated: animated)
          }
        }
      } else {
        // If we popped the last item in a modal stack (but it wasn't marked as modal root? Impossible if logic holds),
        // or we popped the root of base navigator.
        if activeNav === navigator {
          // Don't pop root of base
        }
      }
      emitStateChanged()
      scheduleTeardown(removedRecords)
      return
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
    let options = routerModule?.getOptions(for: name)
    performPush(routeName: name, params: params, options: options, animated: animated)
    // emitStateChanged is called by push()
  }

  func reset(using state: [String: Any], animated: Bool) {
    scheduleNavigationAction { controller in
      controller.performReset(using: state, animated: animated)
    }
  }

  private func performReset(using state: [String: Any], animated: Bool) {
    let previousRecords = routeStack
    // Dismiss any presented modals first
    if let firstModal = routeStack.first(where: { $0.presentedController != nil }) {
      firstModal.presentedController?.dismiss(animated: false)
    }

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
      if let opts = route["options"] as? [String: Any] {
        record.options = opts
      }
      let presentation = route["presentation"] as? String
      let host = RNScreenHostController(
        routeKey: record.key,
        routeName: name,
        params: params,
        isModal: false,
        presentation: presentation
      )
      if let runtime {
        host.attachRuntime(runtime)
      }
      if let emitter {
        host.attachEmitter(emitter)
      }
      record.controller = host
      if let runtime {
        ensureSurface(for: record, runtime: runtime)
      }
      if let surface = record.surfaceView {
        host.attachSurfaceView(surface)
      }
      record.hostingNavigator = navigator
      records.append(record)
      controllers.append(host)
    }
    routeStack = records
    navigator.setViewControllers(controllers, animated: animated)
    scheduleTeardown(previousRecords)
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
    if let host = record.controller, routeStack.last?.controller === host {
      updateInteractivePop(for: host)
    }
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
    } else if let data = try? JSONSerialization.data(
      withJSONObject: payload, options: [.sortedKeys]),
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
    if let record = routeStack.first(where: { $0.key == newFocused }),
      let surfaceId = record.surfaceId
    {
      runtime?.setActiveSurface(surfaceId)
    }
    focusedRouteKey = newFocused
  }

  // MARK: - UINavigationControllerDelegate

  public func navigationController(
    _ navigationController: UINavigationController,
    willShow viewController: UIViewController,
    animated: Bool
  ) {
    transitioningNavigationController = navigationController
    guard let host = viewController as? RNScreenHostController else {
      transitionRouteKey = nil
      return
    }
    attachSurface(to: host)
    updateInteractivePop(for: host)

    // We update the state here to ensure the JS side is aware of the new route (PUSH)
    // immediately, allowing it to render content during the transition.
    emitStateChanged()

    transitionRouteKey = host.routeKey
    emitter?.emitTransitionStart(key: host.routeKey, progress: 0)

    if let coordinator = navigationController.transitionCoordinator {
      transitionCoordinatorRef = coordinator

      // If we are interactively popping, lock the "from" controller (the one potentially being removed)
      // so it doesn't try to refresh tabs during the unstable layout phase.
      weak var fromHost: RNScreenHostController?
      if coordinator.isInteractive,
        let fromVC = coordinator.viewController(forKey: .from) as? RNScreenHostController
      {
        fromVC.isInteractivelyTransitioning = true
        fromHost = fromVC
      }

      coordinator.notifyWhenInteractionEnds { [weak self] context in
        guard let self else { return }

        // Unlock the host
        if let fromHost {
          fromHost.isInteractivelyTransitioning = false
          // If cancelled, we must ensure tabs are refreshed since we skipped it during the gesture
          if context.isCancelled {
            fromHost.view.setNeedsLayout()
            fromHost.view.layoutIfNeeded()
          }
        }

        if !context.isCancelled {
          // Immediately update JS state by removing the popped route from the stack,
          // but defer the actual teardown until the transition completes (in didShow).
          let removed = self.trimRouteStack(for: navigationController)
          // Snapshot removed screens to prevent visual disappearance when JS unmounts the surface
          for record in removed {
            record.controller?.captureSnapshot()
          }
          self.pendingTransitionTeardowns.append(contentsOf: removed)
          self.emitStateChanged()
        }

        self.finishTransition(finished: !context.isCancelled)
      }
      coordinator.notifyWhenInteractionChanges { [weak self] context in
        if !context.isInteractive {
          self?.finishTransition(finished: !context.isCancelled)
        }
      }
      startTransitionDisplayLink()
    } else {
      let removed = trimRouteStack(for: navigationController)
      // Snapshot and defer teardown even for non-interactive/immediate transitions to be safe
      for record in removed {
        record.controller?.captureSnapshot()
      }
      pendingTransitionTeardowns.append(contentsOf: removed)
      emitStateChanged()
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

    let removed = trimRouteStack(for: navigationController)
    // Capture snapshot if we are removing in didShow (though usually caught in willShow)
    for record in removed {
      record.controller?.captureSnapshot()
    }
    pendingTransitionTeardowns.append(contentsOf: removed)

    if !pendingTransitionTeardowns.isEmpty {
      scheduleTeardown(pendingTransitionTeardowns)
      pendingTransitionTeardowns.removeAll()
    }

    emitStateChanged()
    DispatchQueue.main.async { [weak self] in
      self?.flushPendingActionsIfPossible()
    }
  }

  public func navigationController(
    _ navigationController: UINavigationController,
    animationControllerFor operation: UINavigationController.Operation,
    from fromVC: UIViewController,
    to toVC: UIViewController
  ) -> UIViewControllerAnimatedTransitioning? {
    guard let fromHost = fromVC as? RNScreenHostController,
      let toHost = toVC as? RNScreenHostController
    else {
      return nil
    }
    let usesZoom = fromHost.usesZoomTransition || toHost.usesZoomTransition
    let nativeZoom = (fromHost.nativeZoomAvailable || toHost.nativeZoomAvailable)
    if usesZoom && !nativeZoom {
      return ZoomTransitionAnimator(operation: operation)
    }
    return nil
  }

  private func updateInteractivePop(for host: RNScreenHostController) {
    // Disable the default edge-swipe pop when using custom zoom to avoid sideways parallax conflicts,
    // unless the screen explicitly opts in via gestureEnabled. If native zoom is available, allow
    // the system's interactive zoom unless explicitly disabled.
    let override = host.gestureEnabled
    let enableGesture: Bool
    if host.nativeZoomAvailable {
      enableGesture = override ?? true
    } else if host.usesZoomTransition {
      enableGesture = override ?? false
    } else {
      enableGesture = override ?? true
    }
    navigator.interactivePopGestureRecognizer?.isEnabled = enableGesture
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
      if shouldEmitProgress(key: key, progress: progress) {
        emitter?.emitPredictiveBack(key: key, progress: progress, velocity: nil)
      }
    case .ended, .cancelled:
      let velocity = gesture.velocity(in: view).x / view.bounds.width
      emitter?.emitPredictiveBack(
        key: key,
        progress: progress,
        velocity: Double(velocity)
      )
      lastProgressByRoute[key] = nil
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
    if shouldEmitProgress(key: key, progress: progress) {
      emitter?.emitTransitionProgress(key: key, progress: progress)
      if coordinator.isInteractive {
        emitter?.emitPredictiveBack(key: key, progress: progress, velocity: nil)
      }
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
      lastProgressByRoute[key] = nil
    }
    if let nav = transitioningNavigationController {
      clearSnapshots(for: nav)
    }
    transitioningNavigationController = nil
    DispatchQueue.main.async { [weak self] in
      self?.flushPendingActionsIfPossible()
    }
  }

  private func shouldEmitProgress(key: String, progress: Double, force: Bool = false) -> Bool {
    let now = CACurrentMediaTime()
    if !force, let last = lastProgressByRoute[key] {
      let delta = abs(last.progress - progress)
      let dt = now - last.timestamp
      // Skip tiny/noise updates that occur within a single frame (~60fps).
      if delta < 0.05 && dt < (1.0 / 30.0) {
        return false
      }
    }
    lastProgressByRoute[key] = (progress, now)
    return true
  }

  private func attachSurface(to host: RNScreenHostController) {
    guard let record = routeStack.first(where: { $0.controller === host }) else { return }
    guard let surface = record.surfaceView else { return }
    if surface.superview === host.view { return }
    surface.removeFromSuperview()
    host.attachSurfaceView(surface)
    if let surfaceId = record.surfaceId {
      runtime?.setActiveSurface(Int(surfaceId))
    }
    activeHost = host
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

  private func configureTransparentNav(_ nav: UINavigationController) {
    nav.view.backgroundColor = .clear
    nav.view.isOpaque = false
    nav.navigationBar.setBackgroundImage(UIImage(), for: .default)
    nav.navigationBar.shadowImage = UIImage()
    nav.navigationBar.isTranslucent = true
    nav.navigationBar.backgroundColor = .clear
    if #available(iOS 13.0, *) {
      let appearance = UINavigationBarAppearance()
      appearance.configureWithTransparentBackground()
      appearance.backgroundColor = .clear
      nav.navigationBar.standardAppearance = appearance
      nav.navigationBar.scrollEdgeAppearance = appearance
      nav.navigationBar.compactAppearance = appearance
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

  private func trimRouteStack(for navigationController: UINavigationController) -> [RouteRecord] {
    let currentKeys = Set(
      navigationController.viewControllers.compactMap { ($0 as? RNScreenHostController)?.routeKey }
    )
    var removed: [RouteRecord] = []
    routeStack.removeAll { record in
      // Only remove if this record belongs to this navigator AND is not in currentKeys
      if record.hostingNavigator === navigationController {
        guard let controller = record.controller else {
          removed.append(record)
          return true
        }
        let shouldRemove = !currentKeys.contains(controller.routeKey)
        if shouldRemove {
          removed.append(record)
        }
        return shouldRemove
      }
      return false
    }
    return removed
  }

  private func controller(for routeKey: String) -> RNScreenHostController? {
    return routeStack.first(where: { $0.key == routeKey })?.controller
  }

  private func clearSnapshots(for navigationController: UINavigationController?) {
    guard let navigationController else {
      for record in routeStack {
        record.controller?.clearSnapshot()
      }
      return
    }
    for record in routeStack where record.hostingNavigator === navigationController {
      record.controller?.clearSnapshot()
    }
  }

  // MARK: - UIAdaptivePresentationControllerDelegate

  public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    handlePresentedControllerDismissal(presentationController.presentedViewController)
  }

  private func handlePresentedControllerDismissal(_ controller: UIViewController) {
    guard let index = routeStack.lastIndex(where: { $0.presentedController === controller }) else {
      return
    }
    let removedRecords = Array(routeStack[index..<routeStack.count])
    routeStack.removeSubrange(index..<routeStack.count)
    if let host = routeStack.last?.controller {
      attachSurface(to: host)
    } else {
      attachSurfaceToFallbackHost()
      setRouterActive(false)
    }
    if let nav = controller as? UINavigationController {
      clearSnapshots(for: nav)
    } else {
      clearSnapshots(for: navigator)
    }
    emitStateChanged()
    scheduleTeardown(removedRecords)
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

  private func makeSurfaceView() -> UIView {
    let view = UIView(frame: self.view.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.backgroundColor = .clear
    return view
  }

  private func ensureSurface(for record: RouteRecord, runtime: RuneRuntime) {
    guard record.surfaceId == nil else { return }
    let surfaceHost = record.surfaceView ?? makeSurfaceView()
    let surfaceId = runtime.registerSurface(rootView: surfaceHost)
    record.surfaceId = surfaceId
    record.surfaceView = surfaceHost
    if let controller = record.controller {
      controller.attachSurfaceView(surfaceHost)
    }
  }

  private func teardownRecords(_ records: [RouteRecord]) {
    guard let runtime else { return }
    for record in records {
      if let surfaceId = record.surfaceId {
        runtime.unregisterSurface(id: surfaceId)
      }
      record.surfaceView?.removeFromSuperview()
      record.surfaceId = nil
      record.surfaceView = nil
      record.controller?.clearSnapshot()
    }
  }

  private func scheduleTeardown(_ records: [RouteRecord]) {
    guard !records.isEmpty else { return }
    DispatchQueue.main.async { [weak self] in
      self?.teardownRecords(records)
    }
  }
}

// MARK: - Zoom animator

private final class ZoomTransitionAnimator: NSObject, UIViewControllerAnimatedTransitioning {
  private let operation: UINavigationController.Operation
  private let duration: TimeInterval = 0.32
  private let startScale: CGFloat = 0.85
  private let cornerRadius: CGFloat = 18

  init(operation: UINavigationController.Operation) {
    self.operation = operation
    super.init()
  }

  func transitionDuration(using transitionContext: UIViewControllerContextTransitioning?) -> TimeInterval {
    return duration
  }

  func animateTransition(using transitionContext: UIViewControllerContextTransitioning) {
    guard
      let fromView = transitionContext.view(forKey: .from),
      let toView = transitionContext.view(forKey: .to)
    else {
      transitionContext.completeTransition(false)
      return
    }

    let container = transitionContext.containerView
    let isPush = operation == .push

    if isPush {
      toView.frame = container.bounds
      toView.transform = CGAffineTransform(scaleX: startScale, y: startScale)
      toView.alpha = 0.0
      toView.layer.cornerRadius = cornerRadius
      toView.layer.masksToBounds = true
      if #available(iOS 13.0, *) {
        toView.layer.cornerCurve = .continuous
      }
      container.addSubview(toView)
    } else {
      toView.frame = container.bounds
      toView.transform = .identity
      toView.alpha = 1.0
      container.insertSubview(toView, belowSubview: fromView)
    }

    UIView.animate(
      withDuration: duration,
      delay: 0,
      options: [.curveEaseInOut, .allowUserInteraction]
    ) {
      if isPush {
        toView.layer.cornerRadius = 0
        toView.transform = .identity
        toView.alpha = 1.0
      } else {
        fromView.layer.cornerRadius = self.cornerRadius
        fromView.transform = CGAffineTransform(scaleX: self.startScale, y: self.startScale)
        fromView.alpha = 0.0
      }
    } completion: { finished in
      let cancelled = transitionContext.transitionWasCancelled
      if cancelled && isPush {
        toView.removeFromSuperview()
      }
      toView.layer.masksToBounds = false
      fromView.layer.cornerRadius = 0
      fromView.transform = .identity
      transitionContext.completeTransition(finished && !cancelled)
    }
  }
}

// MARK: - Route record

private final class RouteRecord {
  let key: String
  let name: String
  var params: [String: Any]?
  var options: [String: Any]?
  var surfaceId: Int?
  weak var surfaceView: UIView?
  weak var controller: RNScreenHostController?
  weak var hostingNavigator: UINavigationController?
  var presentedController: UIViewController?

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
    if let surfaceId {
      result["meta"] = ["surfaceId": surfaceId]
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

private func mapPresentationStyle(_ style: String?) -> UIModalPresentationStyle {
  switch style {
  case "modal", "formSheet":
    return .formSheet
  case "fullScreen":
    return .fullScreen
  case "pageSheet":
    return .pageSheet
  case "transparentModal":
    return .overFullScreen
  default:
    return .automatic
  }
}
