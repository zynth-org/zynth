import RuneKit
import UIKit

final class RNScreenHostController: UIViewController, UITabBarDelegate {
  let routeKey: String
  let routeName: String
  private var params: [String: Any]?
  private var appliedOptions: [String: Any]?
  private weak var surfaceView: UIView?
  private weak var snapshotView: UIView?
  private var cachedDefaultTintColor: UIColor?
  private var cachedDefaultBarTintColor: UIColor?
  private let contentView = UIView()
  private weak var emitter: RuneRouterEmitter?
  private var tabBar: UITabBar?
  private var tabItemsByName: [String: UITabBarItem] = [:]
  private var tabNameByItem: [UITabBarItem: String] = [:]
  private var tabSelectionHandler: ((String) -> Void)?
  private var suppressTabSelectionCallback = false
  private weak var runtime: RuneRuntime?
  private struct IconHostEntry {
    let host: RuneTabIconHostView
    let name: String
  }
  private var tabIconHosts: [String: IconHostEntry] = [:]
  private var tabIconConfigs: [String: TabIconConfiguration] = [:]
  private var tabConfiguration: TabBarConfiguration?
  private var hasAppliedHeaderVisibility = false
  private var lastEmittedTabMetrics: (height: CGFloat, inset: CGFloat)?

  init(routeKey: String, routeName: String, params: [String: Any]?) {
    self.routeKey = routeKey
    self.routeName = routeName
    self.params = params
    super.init(nibName: nil, bundle: nil)
    title = routeName
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // Match your app's background color to avoid white flash during transitions
    view.backgroundColor = UIColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1.0)  // #101217
    contentView.frame = view.bounds
    contentView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(contentView)
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    applyStoredOptionsToNavigationBar()
  }

  deinit {
    disposeTabIconHosts()
  }

  func updateParams(_ params: [String: Any]?) {
    self.params = params
  }

  func attachRuntime(_ runtime: RuneRuntime) {
    self.runtime = runtime
  }

  func attachEmitter(_ emitter: RuneRouterEmitter?) {
    self.emitter = emitter
  }

  func attachSurfaceView(_ surface: UIView) {
    surface.removeFromSuperview()
    surface.frame = contentView.bounds
    surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    contentView.addSubview(surface)
    surfaceView = surface

    clearSnapshot()
    view.setNeedsLayout()
    view.layoutIfNeeded()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    layoutContentContainers()
    refreshTabIconHosts()
  }

  private func layoutContentContainers() {
    let bounds = view.bounds
    guard let tabBar else {
      contentView.frame = bounds
      surfaceView?.frame = contentView.bounds
      return
    }
    let systemBottom = view.window?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
    let tabContentHeight = tabBar.sizeThatFits(bounds.size).height
    let totalHeight = tabContentHeight + systemBottom
    emitTabBarMetricsIfNeeded(height: totalHeight, inset: systemBottom)
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

  func apply(options: [String: Any]) {
    appliedOptions = options
    if let title = options["title"] as? String {
      navigationItem.title = title
    }
    if let largeTitle = options["largeTitle"] as? Bool {
      navigationItem.largeTitleDisplayMode = largeTitle ? .always : .never
    }
    if let headerShown = options["headerShown"] as? Bool {
      navigationController?.setNavigationBarHidden(!headerShown, animated: true)
    }
    applyStoredOptionsToNavigationBar()
  }



  func configureTabs(
    configuration: TabBarConfiguration,
    selectionHandler: @escaping (String) -> Void
  ) {
    lastEmittedTabMetrics = nil
    tabConfiguration = configuration
    tabIconConfigs.removeAll()
    disposeTabIconHosts()
    tabSelectionHandler = selectionHandler
    let bar: UITabBar
    if let existing = tabBar {
      bar = existing
    } else {
      let created = UITabBar()
      created.delegate = self
      tabBar = created
      bar = created
      view.addSubview(created)
    }
    var items: [UITabBarItem] = []
    tabItemsByName.removeAll()
    tabNameByItem.removeAll()
    for item in configuration.items {
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
    }
    bar.items = items
    applyTabBarAppearance(items: configuration.items)
    view.setNeedsLayout()
    DispatchQueue.main.async { [weak self] in
      self?.refreshTabIconHosts()
    }

    if let initial = configuration.initialRouteName ?? configuration.items.first?.name {
      selectTab(named: initial)
    } else {
      updateTabIconActiveStates()
    }
  }

  func selectTab(named name: String) {
    guard let item = tabItemsByName[name], let bar = tabBar else { return }
    if bar.selectedItem === item { return }
    suppressTabSelectionCallback = true
    bar.selectedItem = item
    updateTabIconActiveStates()
    DispatchQueue.main.async { [weak self] in
      self?.suppressTabSelectionCallback = false
    }
  }

  func removeTabs() {
    tabBar?.delegate = nil
    tabBar?.removeFromSuperview()
    tabBar = nil
    tabItemsByName.removeAll()
    tabNameByItem.removeAll()
    tabSelectionHandler = nil
    disposeTabIconHosts()
    tabIconConfigs.removeAll()
    tabConfiguration = nil
    lastEmittedTabMetrics = nil
    view.setNeedsLayout()
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    if suppressTabSelectionCallback {
      suppressTabSelectionCallback = false
      updateTabIconActiveStates()
      return
    }
    guard let name = tabNameByItem[item] else { return }
    updateTabIconActiveStates()
    tabSelectionHandler?(name)
  }

  private func applyTabBarAppearance(items: [TabBarConfiguration.Item]) {
    guard let tabBar else { return }
    if let backgroundColor = items.compactMap({ $0.backgroundColor }).first {
      tabBar.barTintColor = backgroundColor
      tabBar.backgroundColor = backgroundColor
    } else {
      tabBar.barTintColor = nil
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
    guard let bar = tabBar, let items = bar.items, !items.isEmpty else { return }
    let buttons = collectTabButtons(in: bar)
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
        entry.host.bindIcon(runeId: runeId, isActive: bar.selectedItem === item)
      } else {
        imageView?.isHidden = false
        if let entry = tabIconHosts.removeValue(forKey: key) {
          entry.host.dispose()
          entry.host.removeFromSuperview()
        }
      }
    }

    // Dispose hosts that were not used in this pass
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
      if let control = node as? UIControl {
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
    guard let bar = tabBar else { return }
    for (_, entry) in tabIconHosts {
      guard let item = tabItemsByName[entry.name] else { continue }
      entry.host.updateActiveState(bar.selectedItem === item)
    }
  }

  private func attachHost(_ host: RuneTabIconHostView, to container: UIView, targetView: UIView?) {
    container.layoutIfNeeded()
    if host.superview !== container {
      host.removeFromSuperview()
      container.addSubview(host)
      // Keep system badge/label above the custom icon
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
      // Reserve space for the tab label by pinning the icon to the upper portion of the button.
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

  private func emitTabBarMetricsIfNeeded(height: CGFloat, inset: CGFloat) {
    guard let navigatorId = tabConfiguration?.navigatorId else { return }
    guard let emitter else { return }
    let roundedHeight = Double((height * 1000).rounded() / 1000)
    let roundedInset = Double((inset * 1000).rounded() / 1000)
    if let last = lastEmittedTabMetrics,
      abs(last.height - CGFloat(roundedHeight)) < 0.5,
      abs(last.inset - CGFloat(roundedInset)) < 0.5
    {
      return
    }
    lastEmittedTabMetrics = (CGFloat(roundedHeight), CGFloat(roundedInset))
    emitter.emitTabMetrics(navigatorId: navigatorId, height: roundedHeight, inset: roundedInset)
  }

  private func applyStoredOptionsToNavigationBar() {
    guard let navigationController else { return }
    if cachedDefaultTintColor == nil {
      cachedDefaultTintColor = navigationController.navigationBar.tintColor
    }
    if cachedDefaultBarTintColor == nil {
      cachedDefaultBarTintColor = navigationController.navigationBar.barTintColor
    }
    let options = appliedOptions ?? [:]

    let headerShown = (options["headerShown"] as? Bool) ?? true
    let animate = hasAppliedHeaderVisibility
    navigationController.setNavigationBarHidden(!headerShown, animated: animate)
    if !hasAppliedHeaderVisibility {
      hasAppliedHeaderVisibility = true
    }

    if let style = options["userInterfaceStyle"] as? String {
      applyUserInterfaceStyle(style)
    } else if #available(iOS 13.0, *) {
      overrideUserInterfaceStyle = .unspecified
    }

    if let tintHex = options["headerTintColor"] as? String,
      let tint = UIColor(hex: tintHex)
    {
      navigationController.navigationBar.tintColor = tint
    } else if let cachedDefaultTintColor {
      navigationController.navigationBar.tintColor = cachedDefaultTintColor
    }

    applyAppearanceOptions(options)
  }

  private func applyAppearanceOptions(_ options: [String: Any]) {
    guard hasAppearanceOverrides(options) else {
      resetAppearanceOverrides()
      return
    }
    if #available(iOS 13.0, *) {
      let appearance = UINavigationBarAppearance()
      appearance.configureWithDefaultBackground()
      configure(appearance: appearance, with: options)
      if let tintHex = options["headerTintColor"] as? String,
        let tint = UIColor(hex: tintHex)
      {
        let attributes: [NSAttributedString.Key: Any] = [.foregroundColor: tint]
        appearance.buttonAppearance.normal.titleTextAttributes = attributes
        appearance.doneButtonAppearance.normal.titleTextAttributes = attributes
        appearance.backButtonAppearance.normal.titleTextAttributes = attributes
        appearance.titleTextAttributes = [.foregroundColor: tint]
        appearance.largeTitleTextAttributes = [.foregroundColor: tint]
      }
      navigationItem.standardAppearance = appearance
      navigationItem.scrollEdgeAppearance = appearance
      navigationItem.compactAppearance = appearance
      if #available(iOS 15.0, *) {
        navigationItem.compactScrollEdgeAppearance = appearance
      }
    } else {
      configureLegacyAppearance(with: options)
    }
  }

  @available(iOS 13.0, *)
  private func configure(appearance: UINavigationBarAppearance, with options: [String: Any]) {
    let transparent = options["headerTransparent"] as? Bool ?? false
    let shadowVisible = options["headerShadowVisible"] as? Bool ?? true
    let backgroundColor = (options["headerBackgroundColor"] as? String).flatMap { UIColor(hex: $0) }
    let blurEffect = (options["headerBlurEffect"] as? String).flatMap { blurEffectStyle(from: $0) }
    if transparent {
      appearance.configureWithTransparentBackground()
    } else if let blurEffect {
      appearance.configureWithTransparentBackground()
      appearance.backgroundEffect = UIBlurEffect(style: blurEffect)
      appearance.backgroundColor = backgroundColor
    } else if let backgroundColor {
      appearance.configureWithOpaqueBackground()
      appearance.backgroundColor = backgroundColor
    } else {
      appearance.configureWithDefaultBackground()
    }
    appearance.shadowColor = shadowVisible ? appearance.shadowColor : .clear
  }

  private func configureLegacyAppearance(with options: [String: Any]) {
    guard let navigationBar = navigationController?.navigationBar else { return }
    let transparent = options["headerTransparent"] as? Bool ?? false
    let backgroundColor = (options["headerBackgroundColor"] as? String).flatMap { UIColor(hex: $0) }
    let shadowVisible = options["headerShadowVisible"] as? Bool ?? true

    if transparent {
      navigationBar.setBackgroundImage(UIImage(), for: .default)
      navigationBar.shadowImage = UIImage()
      navigationBar.isTranslucent = true
      navigationBar.backgroundColor = .clear
    } else if let backgroundColor {
      navigationBar.setBackgroundImage(nil, for: .default)
      navigationBar.shadowImage = nil
      navigationBar.isTranslucent = false
      navigationBar.barTintColor = backgroundColor
      navigationBar.backgroundColor = backgroundColor
    } else {
      navigationBar.setBackgroundImage(nil, for: .default)
      navigationBar.shadowImage = nil
      navigationBar.isTranslucent = false
    }

    if !shadowVisible {
      navigationBar.shadowImage = UIImage()
    }
  }

  private func resetAppearanceOverrides() {
    if #available(iOS 13.0, *) {
      navigationItem.standardAppearance = nil
      navigationItem.scrollEdgeAppearance = nil
      navigationItem.compactAppearance = nil
      if #available(iOS 15.0, *) {
        navigationItem.compactScrollEdgeAppearance = nil
      }
    } else if let navigationBar = navigationController?.navigationBar {
      navigationBar.setBackgroundImage(nil, for: .default)
      navigationBar.shadowImage = nil
      navigationBar.isTranslucent = false
      navigationBar.barTintColor = cachedDefaultBarTintColor
      navigationBar.backgroundColor = cachedDefaultBarTintColor
    }
  }

  private func hasAppearanceOverrides(_ options: [String: Any]) -> Bool {
    return options["headerTransparent"] != nil || options["headerBackgroundColor"] != nil
      || options["headerBlurEffect"] != nil || options["headerShadowVisible"] != nil
      || options["headerTintColor"] != nil
  }

  private func applyUserInterfaceStyle(_ style: String) {
    guard #available(iOS 13.0, *) else { return }
    switch style.lowercased() {
    case "dark":
      overrideUserInterfaceStyle = .dark
    case "light":
      overrideUserInterfaceStyle = .light
    case "system":
      overrideUserInterfaceStyle = .unspecified
    default:
      overrideUserInterfaceStyle = .unspecified
    }
  }

  @available(iOS 13.0, *)
  private func blurEffectStyle(from value: String) -> UIBlurEffect.Style? {
    switch value {
    case "systemUltraThin":
      return .systemUltraThinMaterial
    case "systemThin":
      return .systemThinMaterial
    case "systemChromatic":
      if #available(iOS 15.0, *) {
        return .systemChromeMaterial
      } else {
        return .systemMaterial
      }
    default:
      return nil
    }
  }

  func captureSnapshot() {
    guard snapshotView == nil else { return }
    guard view.bounds.width > 0, view.bounds.height > 0 else { return }
    
    view.layoutIfNeeded()
    surfaceView?.layoutIfNeeded()

    // Prefer capturing the surfaceView (actual rendered content) to avoid occasional blank host snapshots.
    let targetView: UIView = surfaceView ?? view
    let targetBounds = targetView.bounds

    // Use afterScreenUpdates: true to ensure we capture the latest state and avoid blank snapshots.
    // This synchronizes with the render server which is critical during transitions.
    var snapshot = targetView.snapshotView(afterScreenUpdates: true)

    // Fallback to drawHierarchy if snapshotView fails (e.g. for WebViews or GL views)
    if snapshot == nil {
      UIGraphicsBeginImageContextWithOptions(targetBounds.size, targetView.isOpaque, 0)
      let success = targetView.drawHierarchy(in: targetBounds, afterScreenUpdates: true)
      let image = UIGraphicsGetImageFromCurrentImageContext()
      UIGraphicsEndImageContext()
      if success, let image {
        snapshot = UIImageView(image: image)
      }
    }

    // Final fallback: render layer directly
    if snapshot == nil {
      let renderer = UIGraphicsImageRenderer(bounds: targetBounds)
      let image = renderer.image { context in
        targetView.layer.render(in: context.cgContext)
      }
      snapshot = UIImageView(image: image)
    }

    guard let finalSnapshot = snapshot else { return }
    finalSnapshot.frame = view.convert(targetBounds, from: targetView)
    finalSnapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(finalSnapshot)
    view.bringSubviewToFront(finalSnapshot)
    snapshotView = finalSnapshot
  }

  func clearSnapshot() {
    snapshotView?.removeFromSuperview()
    snapshotView = nil
  }
}

extension UIColor {
  convenience init?(hex: String) {
    var formatted = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if formatted.hasPrefix("#") {
      formatted.removeFirst()
    }
    guard let value = Int(formatted, radix: 16) else { return nil }
    if formatted.count == 8 {
      let red = CGFloat((value >> 24) & 0xFF) / 255.0
      let green = CGFloat((value >> 16) & 0xFF) / 255.0
      let blue = CGFloat((value >> 8) & 0xFF) / 255.0
      let alpha = CGFloat(value & 0xFF) / 255.0
      self.init(red: red, green: green, blue: blue, alpha: alpha)
    } else if formatted.count == 6 {
      let red = CGFloat((value >> 16) & 0xFF) / 255.0
      let green = CGFloat((value >> 8) & 0xFF) / 255.0
      let blue = CGFloat(value & 0xFF) / 255.0
      self.init(red: red, green: green, blue: blue, alpha: 1)
    } else {
      return nil
    }
  }
}
