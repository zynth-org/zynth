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
  private var tabBar: UITabBar?
  private var tabItemsByName: [String: UITabBarItem] = [:]
  private var tabNameByItem: [UITabBarItem: String] = [:]
  private var tabSelectionHandler: ((String) -> Void)?

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

  func updateParams(_ params: [String: Any]?) {
    self.params = params
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
  }

  private func layoutContentContainers() {
    let bounds = view.bounds
    guard let tabBar else {
      contentView.frame = bounds
      surfaceView?.frame = contentView.bounds
      return
    }
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
        image: item.icon?.makeImage(),
        selectedImage: nil
      )
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

    if let initial = configuration.initialRouteName ?? configuration.items.first?.name {
      selectTab(named: initial)
    }
  }

  func selectTab(named name: String) {
    guard let item = tabItemsByName[name], let bar = tabBar else { return }
    if bar.selectedItem !== item {
      bar.selectedItem = item
    }
  }

  func removeTabs() {
    tabBar?.delegate = nil
    tabBar?.removeFromSuperview()
    tabBar = nil
    tabItemsByName.removeAll()
    tabNameByItem.removeAll()
    tabSelectionHandler = nil
    view.setNeedsLayout()
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard let name = tabNameByItem[item] else { return }
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
    navigationController.setNavigationBarHidden(!headerShown, animated: true)

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
    return options["headerTransparent"] != nil ||
      options["headerBackgroundColor"] != nil ||
      options["headerBlurEffect"] != nil ||
      options["headerShadowVisible"] != nil ||
      options["headerTintColor"] != nil
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
    guard let snapshot = view.snapshotView(afterScreenUpdates: false) else { return }
    snapshot.frame = view.bounds
    snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(snapshot)
    snapshotView = snapshot
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
