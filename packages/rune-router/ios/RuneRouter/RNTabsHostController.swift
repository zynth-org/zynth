import RuneKit
import UIKit

final class RNTabsHostController: UIViewController, UITabBarDelegate {
  let routeKey: String
  private let contentView = UIView()
  private let tabBar = UITabBar()
  private weak var runtime: RuneRuntime?
  private weak var surfaceView: UIView?
  private let emitter: RuneRouterEmitter
  private var tabItemsByName: [String: UITabBarItem] = [:]
  private var tabNameByItem: [UITabBarItem: String] = [:]
  private var tabIconHosts: [String: IconHostEntry] = [:]
  private var tabIconConfigs: [String: TabIconConfiguration] = [:]
  private var configuration: TabBarConfiguration?
  private var selectedTabName: String?
  private var tabRouteKeys: [String: String] = [:]
  private var focusedRouteKey: String?
  private var suppressTabSelectionCallback = false
  private var cachedDefaultTintColor: UIColor?
  private var cachedDefaultBarTintColor: UIColor?

  private struct IconHostEntry {
    let host: RuneTabIconHostView
    let name: String
  }

  init(routeKey: String, emitter: RuneRouterEmitter) {
    self.routeKey = routeKey
    self.emitter = emitter
    self.selectedTabName = nil
    super.init(nibName: nil, bundle: nil)
    title = routeKey
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1.0)  // #101217
    contentView.frame = view.bounds
    contentView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(contentView)

    tabBar.delegate = self
    view.addSubview(tabBar)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    layoutContentContainers()
    refreshTabIconHosts()
  }

  deinit {
    disposeTabIconHosts()
  }

  func attachRuntime(_ runtime: RuneRuntime) {
    self.runtime = runtime
  }

  func installRootSurface(_ surface: UIView) {
    loadViewIfNeeded()
    surface.removeFromSuperview()
    surface.frame = contentView.bounds
    surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    contentView.addSubview(surface)
    surfaceView = surface
    view.setNeedsLayout()
    view.layoutIfNeeded()
  }

  func configureTabs(configuration: TabBarConfiguration) {
    loadViewIfNeeded()
    self.configuration = configuration
    tabBar.delegate = self
    tabIconConfigs.removeAll()
    disposeTabIconHosts()

    var items: [UITabBarItem] = []
    tabItemsByName.removeAll()
    tabNameByItem.removeAll()
    for (index, item) in configuration.items.enumerated() {
      let tabItem = UITabBarItem(
        title: item.label ?? item.name,
        image: nil,
        selectedImage: nil
      )
      if let icon = item.icon {
        tabIconConfigs[item.name] = icon
        if let glyph = icon.glyph {
          tabItem.image = glyph.image(active: false)?.withRenderingMode(.alwaysOriginal)
          tabItem.selectedImage = glyph.image(active: true)?.withRenderingMode(.alwaysOriginal)
        } else if let systemImage = icon.makeSystemImage() {
          tabItem.image = systemImage
          tabItem.selectedImage = systemImage
        }
      }
      tabItem.badgeValue = item.badge
      if #available(iOS 10.0, *) {
        tabItem.badgeColor = item.badgeColor
      }
      items.append(tabItem)
      tabItemsByName[item.name] = tabItem
      tabNameByItem[tabItem] = item.name
      tabRouteKeys[item.name] = item.key ?? tabRouteKeys[item.name] ?? "\(item.name)-\(index)"
    }
    tabBar.items = items
    applyTabBarAppearance(items: configuration.items)
    view.setNeedsLayout()
    DispatchQueue.main.async { [weak self] in
      self?.refreshTabIconHosts()
    }

    let nextSelection = determineInitialSelection(preferred: selectedTabName, configuration: configuration)
    selectTab(named: nextSelection, emitSelectionEvent: false, notifyState: true)
  }

  func selectTab(named name: String?) {
    selectTab(named: name, emitSelectionEvent: true, notifyState: true)
  }

  func removeTabs() {
    tabBar.delegate = nil
    tabBar.items = nil
    tabItemsByName.removeAll()
    tabNameByItem.removeAll()
    tabIconConfigs.removeAll()
    disposeTabIconHosts()
    configuration = nil
    selectedTabName = nil
    tabRouteKeys.removeAll()
    emitStateChanged()
  }

  private func layoutContentContainers() {
    let bounds = view.bounds
    let tabSize = tabBar.sizeThatFits(bounds.size)
    let safeInsets = view.safeAreaInsets
    let totalHeight = tabSize.height + safeInsets.bottom
    tabBar.frame = CGRect(
      x: 0,
      y: bounds.height - totalHeight,
      width: bounds.width,
      height: totalHeight
    )
    contentView.frame = CGRect(
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height - totalHeight
    )
    surfaceView?.frame = contentView.bounds
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    if suppressTabSelectionCallback {
      suppressTabSelectionCallback = false
      updateTabIconActiveStates()
      return
    }
    guard let name = tabNameByItem[item] else { return }
    selectedTabName = name
    updateTabIconActiveStates()
    if let navigator = configuration?.navigatorId {
      emitter.emitTabSelection(navigatorId: navigator, tabName: name)
    }
    emitStateChanged()
  }

  private func determineInitialSelection(preferred: String?, configuration: TabBarConfiguration) -> String? {
    if let preferred, tabItemsByName[preferred] != nil {
      return preferred
    }
    if let initial = configuration.initialRouteName, tabItemsByName[initial] != nil {
      return initial
    }
    return configuration.items.first?.name
  }

  private func selectTab(named name: String?, emitSelectionEvent: Bool, notifyState: Bool) {
    guard let name else { return }
    guard let item = tabItemsByName[name] else { return }
    selectedTabName = name
    if tabBar.selectedItem !== item {
      suppressTabSelectionCallback = true
      tabBar.selectedItem = item
      DispatchQueue.main.async { [weak self] in
        self?.suppressTabSelectionCallback = false
      }
    }
    updateTabIconActiveStates()
    if emitSelectionEvent, let navigator = configuration?.navigatorId {
      emitter.emitTabSelection(navigatorId: navigator, tabName: name)
    }
    if notifyState {
      emitStateChanged()
    }
  }

  private func emitStateChanged() {
    guard let state = currentStatePayload() else { return }
    emitter.emitState(state)
    updateFocusState()
  }

  private func updateFocusState() {
    guard let state = currentStatePayload(),
      let routes = state["routes"] as? [[String: Any]],
      let index = state["index"] as? Int,
      index < routes.count
    else { return }
    let focused = (routes[index]["key"] as? String) ?? (routes[index]["name"] as? String)
    guard let focused else { return }
    if focusedRouteKey == focused {
      return
    }
    if let previous = focusedRouteKey {
      emitter.emitBlur(key: previous)
    }
    emitter.emitFocus(key: focused)
    focusedRouteKey = focused
  }

  func currentStatePayload() -> [String: Any]? {
    guard let configuration else { return nil }
    let activeName = selectedTabName
      ?? configuration.initialRouteName
      ?? configuration.items.first?.name
    let index = configuration.items.firstIndex(where: { $0.name == activeName }) ?? 0
    let routes: [[String: Any]] = configuration.items.enumerated().map { entry in
      let item = entry.element
      var route: [String: Any] = [
        "key": tabRouteKeys[item.name] ?? item.name,
        "name": item.name,
        "type": "tab",
      ]
      if let tabState = snapshotState(for: item.name) {
        route["state"] = tabState
      }
      return route
    }
    return [
      "key": routeKey,
      "type": "tabs",
      "index": max(min(index, routes.count - 1), 0),
      "routes": routes,
    ]
  }

  private func snapshotState(for tabName: String) -> [String: Any]? {
    guard let key = tabRouteKeys[tabName] else { return nil }
    return [
      "key": key,
      "type": "stack",
      "index": 0,
      "routes": [
        [
          "key": key,
          "name": tabName,
        ],
      ],
    ]
  }

  private func applyTabBarAppearance(items: [TabBarConfiguration.Item]) {
    if cachedDefaultTintColor == nil {
      cachedDefaultTintColor = tabBar.tintColor
    }
    if cachedDefaultBarTintColor == nil {
      cachedDefaultBarTintColor = tabBar.barTintColor
    }
    if let backgroundColor = items.compactMap({ $0.backgroundColor }).first {
      tabBar.barTintColor = backgroundColor
      tabBar.backgroundColor = backgroundColor
    } else {
      tabBar.barTintColor = cachedDefaultBarTintColor
      tabBar.backgroundColor = nil
    }
    if let activeColor = items.compactMap({ $0.activeTintColor }).first {
      tabBar.tintColor = activeColor
    } else {
      tabBar.tintColor = cachedDefaultTintColor
    }
    if let inactiveColor = items.compactMap({ $0.inactiveTintColor }).first {
      tabBar.unselectedItemTintColor = inactiveColor
    } else {
      tabBar.unselectedItemTintColor = nil
    }
  }

  private func refreshTabIconHosts() {
    guard let runtime else { return }
    guard let items = tabBar.items, !items.isEmpty else { return }
    let buttons = collectTabButtons(in: tabBar)
    if buttons.isEmpty { return }
    let sortedButtons = buttons.sorted { $0.frame.minX < $1.frame.minX }
    let itemsByTitle: [String: UITabBarItem] = Dictionary(
      uniqueKeysWithValues: items.compactMap { item -> (String, UITabBarItem)? in
        guard let title = item.title?.lowercased(), !title.isEmpty else { return nil }
        return (title, item)
      }
    )

    var usedKeys: Set<String> = []

    for (index, button) in sortedButtons.enumerated() {
      let item: UITabBarItem
      if let title = titleForTabButton(button),
        let matched = itemsByTitle[title.lowercased()]
      {
        item = matched
      } else {
        item = items[index % items.count]
      }
      guard let name = tabNameByItem[item] else { continue }
      let key = "\(name)-\(ObjectIdentifier(button).hashValue)"
      usedKeys.insert(key)

      let imageView = findImageView(in: button)
      let runeId = tabIconConfigs[name]?.runeId

      if let runeId {
        imageView?.isHidden = true
        let entry: IconHostEntry
        if let existing = tabIconHosts[key] {
          entry = existing
        } else {
          let host = RuneTabIconHostView(runtime: runtime)
          entry = IconHostEntry(host: host, name: name)
          tabIconHosts[key] = entry
        }
        attachHost(entry.host, to: button, targetView: imageView)
        button.layoutIfNeeded()
        entry.host.bindIcon(runeId: runeId, isActive: tabBar.selectedItem === item)
      } else {
        imageView?.isHidden = false
        if let entry = tabIconHosts.removeValue(forKey: key) {
          entry.host.dispose()
          entry.host.removeFromSuperview()
        }
      }
    }

    let unusedKeys = tabIconHosts.keys.filter { !usedKeys.contains($0) }
    for key in unusedKeys {
      if let entry = tabIconHosts.removeValue(forKey: key) {
        entry.host.dispose()
        entry.host.removeFromSuperview()
      }
    }
    updateTabIconActiveStates()
    runtime.setActiveSurface(Int(runtime.rootSurfaceId))
  }

  private func collectTabButtons(in view: UIView) -> [UIControl] {
    var result: [UIControl] = []
    func walk(_ node: UIView) {
      if let control = node as? UIControl,
        String(describing: type(of: control)).contains("Tab") || control is UIControl
      {
        result.append(control)
      }
      for child in node.subviews {
        walk(child)
      }
    }
    walk(view)
    return result
  }

  private func updateTabIconActiveStates() {
    for (_, entry) in tabIconHosts {
      guard let item = tabItemsByName[entry.name] else { continue }
      entry.host.updateActiveState(tabBar.selectedItem === item)
    }
  }

  private func attachHost(_ host: RuneTabIconHostView, to container: UIView, targetView: UIView?) {
    container.layoutIfNeeded()
    if host.superview !== container {
      host.removeFromSuperview()
      container.addSubview(host)
      container.sendSubviewToBack(host)
    }
    host.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.deactivate(host.constraints)

    if let target = targetView, target.bounds.width > 1, target.bounds.height > 1 {
      NSLayoutConstraint.activate([
        host.centerXAnchor.constraint(equalTo: target.centerXAnchor),
        host.centerYAnchor.constraint(equalTo: target.centerYAnchor),
        host.widthAnchor.constraint(equalTo: target.widthAnchor),
        host.heightAnchor.constraint(equalTo: target.heightAnchor),
      ])
    } else {
      let heightMultiplier: CGFloat = 0.70
      NSLayoutConstraint.activate([
        host.centerXAnchor.constraint(equalTo: container.centerXAnchor),
        host.topAnchor.constraint(equalTo: container.topAnchor, constant: 6),
        host.heightAnchor.constraint(equalTo: container.heightAnchor, multiplier: heightMultiplier),
        host.widthAnchor.constraint(equalTo: host.heightAnchor),
      ])
    }
  }

  private func findImageView(in view: UIView) -> UIImageView? {
    if let imageView = view as? UIImageView {
      return imageView
    }
    for subview in view.subviews {
      if let imageView = findImageView(in: subview) {
        return imageView
      }
    }
    return nil
  }

  private func disposeTabIconHosts() {
    for (_, entry) in tabIconHosts {
      entry.host.dispose()
      entry.host.removeFromSuperview()
    }
    tabIconHosts.removeAll()
  }

  private func titleForTabButton(_ view: UIView) -> String? {
    if let label = view as? UILabel, let text = label.text, !text.isEmpty {
      return text
    }
    for subview in view.subviews {
      if let found = titleForTabButton(subview) {
        return found
      }
    }
    return nil
  }
}
