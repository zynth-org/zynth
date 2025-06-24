import RuneKit
import UIKit

@available(iOS 16.0, *)
@objcMembers
public final class RNBottomSheetController: UIViewController, UINavigationControllerDelegate,
  RNBottomSheetPresenterDelegate
{
  private let navigator = UINavigationController()
  private var presenter: RNBottomSheetPresenter?
  private var initialConfig: [String: Any]?

  // We need to track the router module to request options
  weak var routerModule: RuneRouterModule?
  weak var runtime: RuneRuntime?
  weak var emitter: RuneRouterEmitter?

    // Route tracking similar to RNStackController but simplified

    private var routeStack: [RouteRecord] = []

    private var recordsToTeardown: [RouteRecord] = []

    

    public var navigatorId: String?

  

    public init(config: [String: Any]?) {

  
    self.initialConfig = config
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  private var lastEmittedStateJSON: String?

  public override func viewDidLoad() {

    super.viewDidLoad()

    view.backgroundColor = .clear

    // Configure internal navigator

    navigator.delegate = self

    configureTransparentNav(navigator)

    // Initialize presenter

    // We use 'self' as the parent. Since 'self' is presented (transparently) or pushed,

    // presenting on top of it works.

    presenter = RNBottomSheetPresenter(contentHost: navigator.view, parentController: self)

    presenter?.delegate = self

    if let config = initialConfig {

      applyConfig(config)

    }

    // Trigger presentation

    // We defer slightly to ensure view hierarchy is ready

    DispatchQueue.main.async { [weak self] in

      self?.presenter?.setOpenState(true, preferredIndex: 0)

    }

  }

  func configureTransparentNav(_ nav: UINavigationController) {

    nav.view.backgroundColor = .clear

    nav.view.isOpaque = false

    nav.navigationBar.setBackgroundImage(UIImage(), for: .default)

    nav.navigationBar.shadowImage = UIImage()

    nav.navigationBar.isTranslucent = true

    nav.navigationBar.backgroundColor = .clear

  }

  func applyConfig(_ config: [String: Any]) {

    var opts = RNBottomSheetOptions()

    if let snaps = config["snapPoints"] as? [Any] {

      opts.snapPoints = BottomSheetSnapPoint.parseList(snaps)

    }

    if let initialIndex = config["initialSnapIndex"] as? Int {

      opts.initialSnapIndex = initialIndex

    }

    if let overlayColor = config["overlayColor"] as? String, let color = UIColor(hex: overlayColor)
    {

      opts.overlayColor = color

    }

    if let opacity = config["overlayOpacity"] as? Double {

      opts.overlayOpacity = CGFloat(opacity)

    }

    if let dismissOnOverlay = config["dismissOnOverlayPress"] as? Bool {

      opts.dismissOnOverlayPress = dismissOnOverlay

    }

    presenter?.updateOptions(opts)

  }

  // MARK: - Presenter Delegate

    func bottomSheetDidDismiss() {

      // The sheet was dismissed by user interaction or programmatically.

      // We should dismiss ourselves to clean up the parent stack/modal.

      if let nav = navigationController, nav.viewControllers.last === self {

         nav.popViewController(animated: false)

      } else {

         dismiss(animated: false)

      }

      flushTeardown()

    }

    

    private func flushTeardown() {

        let records = recordsToTeardown

        recordsToTeardown = []

        if !records.isEmpty {

            DispatchQueue.main.async { [weak self] in

                self?.teardownRecords(records)

            }

        }

    }

  

  func bottomSheetDidChangeSnap(index: Int, progress: CGFloat) {

    // No-op for now

  }

  // MARK: - Navigation Delegate

    public func navigationController(_ navigationController: UINavigationController, willShow viewController: UIViewController, animated: Bool) {

        if let coordinator = navigationController.transitionCoordinator {

            coordinator.animate(alongsideTransition: nil) { [weak self] context in

                if !context.isCancelled {

                    self?.flushTeardown()

                }

            }

        } else {

            flushTeardown()

        }

  

        guard let host = viewController as? RNScreenHostController else { return }

        

        // Attach surface if needed

        attachSurface(to: host)

  

    // Update snap points from screen options

    // We need to fetch options. Host has appliedOptions?

    // Or we fetch from routerModule.

    // For now, we assume options are passed via route update or applied to host.

    // But we need to read them.

    // Let's look up options from router module if available

    if let module = routerModule, let options = module.getOptions(for: host.routeName) {

      updateSheetOptions(from: options)

    }

  }

  public func navigationController(
    _ navigationController: UINavigationController, didShow viewController: UIViewController,
    animated: Bool
  ) {

    if let host = viewController as? RNScreenHostController {

      attachSurface(to: host)

    }

  }

  private func updateSheetOptions(from screenOptions: [String: Any]) {

    guard let sheetOptions = screenOptions["bottomSheet"] as? [String: Any] else { return }

    applyConfig(sheetOptions)

    // Also snap to initial index if provided?

    if let index = sheetOptions["initialSnapIndex"] as? Int {

      presenter?.snapTo(index: index)

    }

  }

  // MARK: - Operations (Called by Parent/Router)

  func push(routeName: String, params: [String: Any]?, options: [String: Any]?, animated: Bool) {

    let record = RouteRecord(name: routeName, params: params)

    let host = RNScreenHostController(
      routeKey: record.key, routeName: routeName, params: params, isModal: false)

    if let runtime { host.attachRuntime(runtime) }

    if let emitter { host.attachEmitter(emitter) }

    record.controller = host

    if let runtime { ensureSurface(for: record, runtime: runtime) }

    if let surface = record.surfaceView { host.attachSurfaceView(surface) }

    routeStack.append(record)

    navigator.pushViewController(host, animated: animated)

    emitStateChanged()

  }

      func pop(count: Int, animated: Bool) {

          // Simplified pop

          let removeCount = min(count, routeStack.count)

          guard removeCount > 0 else { return }

          

          // Capture snapshot of the top controller to preserve visual state during animation

          // while JS unmounts the surface.

          if animated, let topRecord = routeStack.last {

              topRecord.controller?.captureSnapshot()

          }

          

          let removedRecords = Array(routeStack.suffix(removeCount))

          routeStack.removeLast(removeCount)

          

          recordsToTeardown.append(contentsOf: removedRecords)

          

          if routeStack.isEmpty {

              presenter?.dismiss()

          } else {

              navigator.popViewController(animated: animated)

              if !animated {

                  flushTeardown()

              }

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

    for (k, v) in options { next[k] = v }

    record.options = next

    record.controller?.apply(options: next)

    if routeStack.last?.key == key {

      updateSheetOptions(from: next)

    }

  }

      func reset(using state: [String: Any], animated: Bool) {

          let previousRecords = routeStack

          recordsToTeardown.append(contentsOf: previousRecords)

          

          // Snapshot the previous top screen if animating

          if animated, let previousTop = previousRecords.last {

              previousTop.controller?.captureSnapshot()

          }

          

          if let config = state["config"] as? [String: Any] {

              applyConfig(config)

          }

    

        

        guard let routes = state["routes"] as? [[String: Any]] else { return }

        

        var newControllers: [UIViewController] = []

        var newRecords: [RouteRecord] = []

        

        for route in routes {

            guard let name = route["name"] as? String else { continue }

            let params = route["params"] as? [String: Any]

            let key = (route["key"] as? String) ?? UUID().uuidString

            let record = RouteRecord(name: name, params: params, key: key)

            let host = RNScreenHostController(routeKey: key, routeName: name, params: params, isModal: false)

            

            if let runtime { host.attachRuntime(runtime) }

            if let emitter { host.attachEmitter(emitter) }

            record.controller = host

            if let runtime { ensureSurface(for: record, runtime: runtime) }

            if let surface = record.surfaceView { host.attachSurfaceView(surface) }

            

            newRecords.append(record)

            newControllers.append(host)

        }

        

        routeStack = newRecords

        navigator.setViewControllers(newControllers, animated: animated)

        if !animated {

            flushTeardown()

        }

        

        emitStateChanged()

        

        if let activeHost = newControllers.last as? RNScreenHostController {

            attachSurface(to: activeHost)

        }

    }

  

  // Helpers duplicated from RNStackController (simplified)

  func hasRoute(withKey key: String) -> Bool {

    return routeStack.contains(where: { $0.key == key })

  }

  func notifyScreenRendered(surfaceId: Int) {

    // We can implement waiting logic here if we want to delay presentation until render.

    // For now, just a placeholder or trigger any pending animations if we add that logic later.

  }

  private func ensureSurface(for record: RouteRecord, runtime: RuneRuntime) {

    guard record.surfaceId == nil else { return }

    // Use screen bounds to ensure we have a non-zero initial frame for Yoga layout

    let surfaceHost = record.surfaceView ?? UIView(frame: UIScreen.main.bounds)

    surfaceHost.autoresizingMask = [.flexibleWidth, .flexibleHeight]

    surfaceHost.backgroundColor = .clear

    // Register surface with runtime

    let id = runtime.registerSurface(rootView: surfaceHost)

    record.surfaceId = id

    record.surfaceView = surfaceHost

    record.controller?.attachSurfaceView(surfaceHost)

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

    }

  }

  private func scheduleTeardown(_ records: [RouteRecord]) {

    guard !records.isEmpty else { return }

    DispatchQueue.main.async { [weak self] in

      self?.teardownRecords(records)

    }

  }

  // MARK: - State Emitting

  func currentStatePayload() -> [String: Any] {

    let routes = routeStack.map { $0.asDictionary() }

    return [

      "key": navigatorId ?? "unknown-sheet",

      "type": "bottomSheet",

      "index": max(routes.count - 1, 0),

      "routes": routes,

    ]

  }

  private func emitStateChanged() {

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

    if let newFocused = routeStack.last?.key {

      emitter.emitFocus(key: newFocused)

      if let record = routeStack.first(where: { $0.key == newFocused }),

        let surfaceId = record.surfaceId
      {

        runtime?.setActiveSurface(surfaceId)

      }

    }

  }

}

// Helper struct to avoid dependency on RNStackController private types

private class RouteRecord {

  let key: String

  let name: String

  var params: [String: Any]?

  var options: [String: Any]?

  var surfaceId: Int?

  weak var surfaceView: UIView?

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

    if let surfaceId {

      result["meta"] = ["surfaceId": surfaceId]

    }

    return result

  }

}

