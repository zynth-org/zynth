import RuneKit
import UIKit

struct RuneNativeTabBarOptions: Equatable {
  var visible: Bool
  var backgroundColor: UIColor?
  var activeTintColor: UIColor?
  var inactiveTintColor: UIColor?
  var showLabels: Bool
  var blurEffectStyle: UIBlurEffect.Style?

  static let `default` = RuneNativeTabBarOptions(
    visible: true,
    backgroundColor: nil,
    activeTintColor: UIColor.systemBlue,
    inactiveTintColor: UIColor.systemGray,
    showLabels: true,
    blurEffectStyle: .systemUltraThinMaterial
  )
}

struct RuneNativeTabBarItem: Equatable {
  var key: String
  var routeName: String
  var label: String?
  var badge: String?
  var badgeColor: UIColor?
  var hidden: Bool
  var icon: RuneNativeTabIcon?
}

enum RuneNativeTabIcon: Equatable {
  case descriptor(RuneNativeTabBarIconDescriptor)
  case surface(routeKey: String)
}

struct RuneNativeTabBarIconDescriptor: Equatable {
  var systemName: String?
  var assetName: String?
  var uri: String?
  var glyph: String?
  var glyphFontFamily: String?
  var glyphFontSize: CGFloat?
}

@objcMembers
public final class RuneScreenTabsContainerView: UIView, UITabBarControllerDelegate {
  private var tabViews: [UIView] = []
  private var controllerMap: [ObjectIdentifier: RuneTabContentViewController] = [:]
  private var tabDescriptors: [RuneNativeTabBarItem] = [] {
    didSet { updateTabBarItems() }
  }
  private var tabBarOptions: RuneNativeTabBarOptions = .default {
    didSet {
      applyTabBarAppearance()
      // Defer icon host refresh with triple async for label stability
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.tabBarController?.tabBar.layoutIfNeeded()
        DispatchQueue.main.async { [weak self] in
          guard let self else { return }
          self.tabBarController?.tabBar.setNeedsLayout()
          self.tabBarController?.tabBar.layoutIfNeeded()
          DispatchQueue.main.async { [weak self] in
            self?.refreshIconHosts()
          }
        }
      }
    }
  }
  private var selectedIndex: Int = 0
  private var nativeTabBarEnabled = false
  private weak var manager: SNUIManager?
  private weak var node: SNNode?
  private weak var runtime: RuneRuntime?
  private weak var hostingController: UIViewController?
  private var tabBarController: UITabBarController?
  private var isApplyingNativeSelection = false
  private var iconHostEntries: [String: NativeTabIconHostEntry] = [:]
  private var pendingTabSwitch: Int?
  private var tabSwitchWorkItem: DispatchWorkItem?
  private var readyContentViewIdentifiers: Set<ObjectIdentifier> = []
  private var tabAnimationType: RuneScreenAnimation = .none
  private let tabBarButtonClass: AnyClass? = NSClassFromString("UITabBarButton")
  private lazy var surfaceIconPlaceholder: UIImage = {
    let size = CGSize(width: 24, height: 24)
    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { context in
      UIColor.clear.setFill()
      context.fill(CGRect(origin: .zero, size: size))
    }.withRenderingMode(.alwaysOriginal)
  }()

  public override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  public required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    clipsToBounds = true
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    tabBarController?.view.frame = bounds
    // Defer icon host refresh with triple async dispatch to ensure labels are fully laid out.
    // Each dispatch gives UITabBar another run loop to complete its internal layout work.
    DispatchQueue.main.async { [weak self] in
      guard let self, self.nativeTabBarEnabled else { return }
      self.tabBarController?.tabBar.layoutIfNeeded()
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.tabBarController?.tabBar.setNeedsLayout()
        self.tabBarController?.tabBar.layoutIfNeeded()
        DispatchQueue.main.async { [weak self] in
          self?.refreshIconHosts()
        }
      }
    }
    if !nativeTabBarEnabled {
      updateTabVisibility()
    }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      attachTabBarControllerIfNeeded()
      synchronizeTabs()
    } else {
      detachTabBarController()
    }
  }

  @objc(bindWithManager:node:)
  public func bind(withManager manager: SNUIManager, node: SNNode) {
    self.manager = manager
    self.node = node
    self.runtime = RuneRuntimeManagerRegistry.shared.runtime(for: manager)
  }

  public func prepareForReuse() {
    manager = nil
    node = nil
    runtime = nil
    clearIconHosts()
    controllerMap.removeAll()
    tabViews.removeAll()
    readyContentViewIdentifiers.removeAll()
    detachTabBarController()
  }

  @objc(setTabAnimationType:)
  public func setTabAnimationType(_ value: NSString?) {
    let stringValue = value as String?
    let newType: RuneScreenAnimation
    if let stringValue, !stringValue.isEmpty {
      newType = RuneScreenAnimation(string: stringValue)
    } else {
      newType = .none
    }
    guard tabAnimationType != newType else { return }
    tabAnimationType = newType
  }

  @objc(insertTabContentView:atIndex:)
  public func insertTabContentView(_ view: UIView, at index: Int) {
    let clamped = max(0, min(index, tabViews.count))
    NSLog("[RuneScreenTabs] insertTabContentView at index \(index) (clamped: \(clamped)), view: \(view), nativeEnabled: \(nativeTabBarEnabled)")
    if let existingIndex = tabViews.firstIndex(where: { $0 === view }) {
      NSLog("[RuneScreenTabs] View already exists at index \(existingIndex), removing")
      tabViews.remove(at: existingIndex)
    }
    tabViews.insert(view, at: clamped)
    NSLog("[RuneScreenTabs] Total tabViews count: \(tabViews.count)")

    if nativeTabBarEnabled {
      adoptViewForNativeTabs(view)
      synchronizeTabs()
    } else {
      insertSubview(view, at: min(clamped, subviews.count))
      updateTabVisibility()
    }
  }

  @objc(removeTabContentView:)
  public func removeTabContentView(_ view: UIView) {
    if let index = tabViews.firstIndex(where: { $0 === view }) {
      tabViews.remove(at: index)
    }
    clearReadyState(for: view)
    if nativeTabBarEnabled {
      controllerMap.removeValue(forKey: ObjectIdentifier(view))
      synchronizeTabs()
    } else {
      view.removeFromSuperview()
      updateTabVisibility()
    }
  }

    private var transitionOverlay: UIView?
    private var contentWaitWorkItem: DispatchWorkItem?
    private var pendingWaitIndex: Int?
  
    // ... (init and layoutSubviews remain same)
  
    // ...
  
  public func setSelectedIndexValue(_ value: NSNumber?) {
      let proposed = value?.intValue ?? 0
      selectedIndex = clampIndex(proposed)
      NSLog("[RuneScreenTabs] setSelectedIndexValue - proposed: \(proposed), clamped: \(selectedIndex), nativeEnabled: \(nativeTabBarEnabled)")
      if nativeTabBarEnabled {
        guard let controller = tabBarController else {
          NSLog("[RuneScreenTabs] ERROR: tabBarController is nil!")
          return
        }
        let clamped = clampIndex(selectedIndex)
        NSLog("[RuneScreenTabs] Current controller.selectedIndex: \(controller.selectedIndex), new: \(clamped)")
        
        if controller.selectedIndex != clamped {
          // If programmatic selection to unready tab, show overlay
          let targetView = tabViews[clamped]
          if !isContentReady(targetView) {
            addTransitionOverlay(from: controller.selectedViewController?.view, tabBarController: controller)
            waitForContentAndRemoveOverlay(for: clamped)
          }
          controller.selectedIndex = clamped
        }
        updateIconHostStates()
      } else {
        updateTabVisibility()
      }
    }
  
  @objc(setTabBarOptionsFromDictionary:)
  public func setTabBarOptions(from dictionary: NSDictionary?) {
    var options = RuneNativeTabBarOptions.default
    if let dict = dictionary as? [String: Any] {
      if let visible = dict["visible"] as? Bool {
        options.visible = visible
      } else if let number = dict["visible"] as? NSNumber {
        options.visible = number.boolValue
      }
      if let background = dict["backgroundColor"] as? String {
        options.backgroundColor = UIColor.rune_color(from: background)
      }
      if let activeTint = dict["activeTintColor"] as? String {
        options.activeTintColor = UIColor.rune_color(from: activeTint)
      }
      if let inactiveTint = dict["inactiveTintColor"] as? String {
        options.inactiveTintColor = UIColor.rune_color(from: inactiveTint)
      }
      if let showLabels = dict["showLabels"] as? Bool {
        options.showLabels = showLabels
      } else if let number = dict["showLabels"] as? NSNumber {
        options.showLabels = number.boolValue
      }
      if let blurStyle = dict["blurEffectStyle"] as? String {
        if blurStyle == "none" {
          options.blurEffectStyle = nil
        } else {
          options.blurEffectStyle = UIBlurEffect.Style(string: blurStyle)
        }
      }
    }
    guard tabBarOptions != options else { return }
    tabBarOptions = options
  }

  @objc(setTabItemsFromArray:)
  public func setTabItems(from array: NSArray?) {
    guard let objects = array as? [Any], !objects.isEmpty else {
      if !tabDescriptors.isEmpty {
        tabDescriptors = []
      }
      return
    }
    let descriptors: [RuneNativeTabBarItem] = objects.compactMap { element in
      guard let dict = element as? [String: Any] else { return nil }
      return RuneNativeTabBarItem(dictionary: dict)
    }
    guard tabDescriptors != descriptors else { return }
    tabDescriptors = descriptors
  }

  @objc(setNativeTabBarEnabledValue:)
  public func setNativeTabBarEnabledValue(_ value: NSNumber?) {
    let enabled = value?.boolValue ?? false
    guard enabled != nativeTabBarEnabled else { return }
    nativeTabBarEnabled = enabled

    if enabled {
      for view in tabViews {
        adoptViewForNativeTabs(view)
      }
      attachTabBarControllerIfNeeded()
      synchronizeTabs()
    } else {
      detachTabBarController()
      for (index, view) in tabViews.enumerated() {
        if view.superview !== self {
          insertSubview(view, at: min(index, subviews.count))
        }
      }
      updateTabVisibility()
    }
  }
  
    // ...
  
    // MARK: - UITabBarControllerDelegate
    
    public func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
      guard nativeTabBarEnabled else { return true }
      guard let controllers = tabBarController.viewControllers else { return true }
      guard let targetIndex = controllers.firstIndex(of: viewController) else { return true }
      
      let currentIndex = tabBarController.selectedIndex
      NSLog("[RuneScreenTabs] shouldSelect - current: \(currentIndex), target: \(targetIndex)")
      
      // If already selected or programmatic, allow immediate switch
      if targetIndex == currentIndex || isApplyingNativeSelection {
        return true
      }
      
      // User-initiated tap
      let targetView = tabViews[targetIndex]
      
      // Check if content is ready
      if isContentReady(targetView) {
          NSLog("[RuneScreenTabs] Content ready for index \(targetIndex), allowing immediate switch")
          selectedIndex = targetIndex
          updateIconHostStates()
          
          // Notify JS
          dispatchEvent(name: "onNativeTabSelect", payload: ["index": targetIndex] as NSDictionary)
          return true
      } else {
          NSLog("[RuneScreenTabs] Content NOT ready for index \(targetIndex). Showing overlay and switching immediately.")
          
          // 1. Snapshot current view to freeze the screen visually
          addTransitionOverlay(from: tabBarController.selectedViewController?.view, tabBarController: tabBarController)
          NSLog("[RuneScreenTabs] Transition overlay added")
          
          // 2. Start polling for readiness
          waitForContentAndRemoveOverlay(for: targetIndex)
          
          // 3. Update state
          selectedIndex = targetIndex
          updateIconHostStates()
          dispatchEvent(name: "onNativeTabSelect", payload: ["index": targetIndex] as NSDictionary)
          
          // 4. Return TRUE to allow immediate animation
          return true
      }
    }
  
  // ... (didSelect remains)

  // MARK: - Private helpers

  private func clearReadyState(for view: UIView) {
    readyContentViewIdentifiers.remove(ObjectIdentifier(view))
  }

  private func markViewReady(_ view: UIView) {
    readyContentViewIdentifiers.insert(ObjectIdentifier(view))
  }

  private func addTransitionOverlay(from currentView: UIView?, tabBarController: UITabBarController) {
    guard transitionOverlay == nil else { return }
    guard let currentView = currentView else { return }
    guard let snapshot = currentView.snapshotView(afterScreenUpdates: false) else { return }
    snapshot.frame = currentView.frame
    snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    if let container = currentView.superview {
      container.addSubview(snapshot)
    } else {
      tabBarController.view.insertSubview(snapshot, belowSubview: tabBarController.tabBar)
    }
    transitionOverlay = snapshot
  }

  private func waitForContentAndRemoveOverlay(for index: Int) {
    contentWaitWorkItem?.cancel()
    pendingWaitIndex = index

    guard index < tabViews.count else {
      removeTransitionOverlay()
      pendingWaitIndex = nil
      return
    }
    let targetView = tabViews[index]
    let startTime = Date()
    let maxWaitTime: TimeInterval = 0.5 // Safety timeout

    func check() {
      guard pendingWaitIndex == index else { return }

      let ready = isContentReady(targetView)
      let elapsed = Date().timeIntervalSince(startTime)

      if ready || elapsed > maxWaitTime {
        NSLog("[RuneScreenTabs] Content ready (or timeout) for index \(index) after \(String(format: "%.3f", elapsed))s. Removing overlay.")

        if ready {
          markViewReady(targetView)
        }

        // Fade out overlay
        UIView.animate(withDuration: 0.2, animations: {
          self.transitionOverlay?.alpha = 0.0
        }) { _ in
          if self.pendingWaitIndex == index {
            self.removeTransitionOverlay()
            self.pendingWaitIndex = nil
          }
        }
      } else {
        // Poll every frame (approx 16ms)
        let nextItem = DispatchWorkItem { check() }
        self.contentWaitWorkItem = nextItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.016, execute: nextItem)
      }
    }

    // Start checking
    let initialItem = DispatchWorkItem { check() }
    contentWaitWorkItem = initialItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.016, execute: initialItem)
  }

  private func removeTransitionOverlay() {
    transitionOverlay?.removeFromSuperview()
    transitionOverlay = nil
  }

  private func isContentReady(_ view: UIView) -> Bool {
    let identifier = ObjectIdentifier(view)
    if readyContentViewIdentifiers.contains(identifier) {
      return true
    }
    // Check if view has meaningful content
    guard !view.subviews.isEmpty else { return false }

    // Count subviews with substantial frames (not 1x1 placeholders)
    var substantialViewCount = 0
    func checkViewTree(_ v: UIView, depth: Int) {
      // Don't go too deep
      guard depth < 5 else { return }

      // Check if this view has a substantial frame
      let frame = v.frame
      if frame.width > 10 && frame.height > 10 {
        substantialViewCount += 1
      }

      // Check children
      for subview in v.subviews where !subview.isHidden {
        checkViewTree(subview, depth: depth + 1)
      }
    }

    checkViewTree(view, depth: 0)
    // Need at least 2 substantial views (container + content)
    if substantialViewCount >= 2 {
      markViewReady(view)
      return true
    }
    return false
  }
  public func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
    guard nativeTabBarEnabled else { return }
    guard let controllers = tabBarController.viewControllers else { return }
    guard let index = controllers.firstIndex(of: viewController) else { return }
    NSLog("[RuneScreenTabs] didSelect viewController at index \(index), title: \(viewController.title ?? "nil"), isApplying: \(isApplyingNativeSelection)")
    // This is called AFTER shouldSelect returned true, so the switch already happened
    // Just update our state
    selectedIndex = index
    updateIconHostStates()
  }

  // MARK: - Private helpers

  private func refreshIconHosts() {
    guard nativeTabBarEnabled, let tabBar = tabBarController?.tabBar else { return }
    guard let items = tabBar.items, !items.isEmpty else {
      clearIconHosts()
      return
    }

    tabBar.layoutIfNeeded()
    
    // UITabBar structure:
    // - _UITabBarPlatterView (iOS 18+) or direct subviews
    //   - ContentView: contains buttons showing INACTIVE state
    //   - SelectedContentView: contains buttons showing ACTIVE state (above selection indicator)
    // We need to attach icon hosts to buttons in BOTH views.
    
    let (normalButtons, selectedButtons) = collectDualTabButtons(in: tabBar)
    
    // NSLog("[RuneScreenTabs] refreshIconHosts: Found \(normalButtons.count) normal buttons, \(selectedButtons.count) selected buttons")

    if normalButtons.isEmpty && selectedButtons.isEmpty {
      clearIconHosts()
      return
    }

    let itemsByTitle = Dictionary(uniqueKeysWithValues: items.compactMap { item -> (String, UITabBarItem)? in
      guard let title = item.title?.lowercased(), !title.isEmpty else { return nil }
      return (title, item)
    })

    var itemIndexMap: [ObjectIdentifier: Int] = [:]
    for (index, item) in items.enumerated() {
      itemIndexMap[ObjectIdentifier(item)] = index
    }

    var activeKeys: Set<String> = []
    
    // Use normal buttons for iteration (they should match 1:1 with selected buttons)
    let buttonsToIterate = normalButtons.isEmpty ? selectedButtons : normalButtons

    for (position, button) in buttonsToIterate.enumerated() {
      guard let (item, itemIndex) = resolveTabBarItem(
        for: button,
        items: items,
        itemsByTitle: itemsByTitle,
        fallbackIndex: position,
        itemIndexMap: itemIndexMap
      ) else {
        continue
      }

      guard itemIndex < tabDescriptors.count else {
        continue
      }

      let descriptor = tabDescriptors[itemIndex]
      let descriptorRouteKey = descriptor.key

      if descriptor.hidden {
        showNativeIcon(in: button)
        if position < selectedButtons.count {
          showNativeIcon(in: selectedButtons[position])
        }
        removeIconHosts(forRouteKey: descriptorRouteKey)
        continue
      }
      
      guard let icon = descriptor.icon else {
        showNativeIcon(in: button)
        if position < selectedButtons.count {
          showNativeIcon(in: selectedButtons[position])
        }
        removeIconHosts(forRouteKey: descriptorRouteKey)
        continue
      }

      switch icon {
      case .descriptor:
        showNativeIcon(in: button)
        if position < selectedButtons.count {
          showNativeIcon(in: selectedButtons[position])
        }
        removeIconHosts(forRouteKey: descriptorRouteKey)
      case .surface(let routeKey):
        let key = routeKey
        activeKeys.insert(key)
        
        // Find containers and image views in both normal and selected buttons
        let normalButton = position < normalButtons.count ? normalButtons[position] : nil
        let selectedButton = position < selectedButtons.count ? selectedButtons[position] : nil
        
        let normalImageView = normalButton.flatMap { findIconImageView(in: $0) }
        let selectedImageView = selectedButton.flatMap { findIconImageView(in: $0) }
        
        // Hide native image views
        hideImageView(normalImageView)
        hideImageView(selectedImageView)
        
        let normalContainer = normalImageView?.superview ?? normalButton
        let selectedContainer = selectedImageView?.superview ?? selectedButton

        if let existing = iconHostEntries[key] {
          // Update existing entry - re-attach hosts if needed
          existing.index = itemIndex
          existing.routeKey = routeKey
          
          if let container = normalContainer, existing.normalHost.superview !== container {
            existing.normalContainer = container
            attachIconHost(existing.normalHost, to: container, targetView: normalImageView)
          }
          if let container = selectedContainer, existing.selectedHost.superview !== container {
            existing.selectedContainer = container
            attachIconHost(existing.selectedHost, to: container, targetView: selectedImageView)
          }
        } else {
          // Create new entry with dual hosts
          let normalHost = RuneTabIconHostView()
          let selectedHost = RuneTabIconHostView()
          let entry = NativeTabIconHostEntry(
            normalHost: normalHost,
            selectedHost: selectedHost,
            index: itemIndex,
            routeKey: routeKey
          )
          entry.normalContainer = normalContainer
          entry.selectedContainer = selectedContainer
          iconHostEntries[key] = entry
          
          // Configure both hosts with the same route (they share the same JS icon registry entry)
          normalHost.configure(routeKey: routeKey, runtime: runtime)
          selectedHost.configure(routeKey: routeKey, runtime: runtime)
          
          // Attach to respective containers
          if let container = normalContainer {
            attachIconHost(normalHost, to: container, targetView: normalImageView)
          }
          if let container = selectedContainer {
            attachIconHost(selectedHost, to: container, targetView: selectedImageView)
          }
        }
      }
    }

    let unusedKeys = iconHostEntries.keys.filter { !activeKeys.contains($0) }
    for key in unusedKeys {
      removeIconHostEntry(forKey: key)
    }
    updateIconHostStates()
  }
  
  /// Find tab buttons in both ContentView (normal) and SelectedContentView (selected)
  private func collectDualTabButtons(in tabBar: UITabBar) -> (normal: [UIView], selected: [UIView]) {
    var normalButtons: [UIView] = []
    var selectedButtons: [UIView] = []
    
    // Look for _UITabBarPlatterView or similar container
    func findContentViews(in view: UIView) -> (normal: UIView?, selected: UIView?) {
      var normalView: UIView?
      var selectedView: UIView?
      
      for subview in view.subviews {
        let className = String(describing: type(of: subview))
        // Look for ContentView (normal state) and SelectedContentView (selected state)
        if className.contains("SelectedContentView") {
          selectedView = subview
        } else if className.contains("ContentView") && !className.contains("Selected") {
          normalView = subview
        }
        
        // Recurse into container views that might hold the content views
        if className.contains("PlatterView") || className.contains("Container") {
          let (n, s) = findContentViews(in: subview)
          if n != nil { normalView = n }
          if s != nil { selectedView = s }
        }
      }
      
      return (normalView, selectedView)
    }
    
    let (normalContentView, selectedContentView) = findContentViews(in: tabBar)
    
    // Collect buttons from normal content view
    if let normalView = normalContentView {
      normalButtons = collectTabButtons(in: normalView)
    }
    
    // Collect buttons from selected content view
    if let selectedView = selectedContentView {
      selectedButtons = collectTabButtons(in: selectedView)
    }
    
    // Fallback: if we didn't find the dual structure, use the old approach
    if normalButtons.isEmpty && selectedButtons.isEmpty {
      normalButtons = collectTabButtons(in: tabBar)
    }
    
    return (normalButtons, selectedButtons)
  }
  
  private func hideImageView(_ imageView: UIImageView?) {
    guard let imageView else { return }
    imageView.isHidden = true
    imageView.alpha = 0.0
  }

  private func collectTabButtons(in view: UIView) -> [UIView] {
    var result: [UIView] = []
    var seen = Set<ObjectIdentifier>()

    func walk(_ node: UIView) {
      if let control = node as? UIControl {
        let className = String(describing: type(of: control))
        let matchesExplicitClass = tabBarButtonClass.flatMap { control.isKind(of: $0) } ?? false
        let matchesName = className.contains("TabButton") || className.contains("TabBarButton")
        if matchesExplicitClass || matchesName {
          let identifier = ObjectIdentifier(control)
          if !seen.contains(identifier) {
            seen.insert(identifier)
            result.append(control)
          }
          return
        }
      }
      for child in node.subviews {
        walk(child)
      }
    }

    walk(view)

    return result.sorted { $0.frame.minX < $1.frame.minX }
  }

  private func resolveTabBarItem(
    for button: UIView,
    items: [UITabBarItem],
    itemsByTitle: [String: UITabBarItem],
    fallbackIndex: Int,
    itemIndexMap: [ObjectIdentifier: Int]
  ) -> (UITabBarItem, Int)? {
    if let title = titleForTabButton(button)?.lowercased(), let matched = itemsByTitle[title],
      let index = itemIndexMap[ObjectIdentifier(matched)]
    {
      return (matched, index)
    }
    guard !items.isEmpty else { return nil }
    let fallbackItem = items[fallbackIndex % items.count]
    guard let index = itemIndexMap[ObjectIdentifier(fallbackItem)] else { return nil }
    return (fallbackItem, index)
  }

  private func attachIconHost(_ host: RuneTabIconHostView, to container: UIView, targetView: UIView?) {
    // Ensure container has stable layout before attaching
    container.setNeedsLayout()
    container.layoutIfNeeded()
    
    if host.superview !== container {
      host.removeFromSuperview()
      if let target = targetView, target.superview === container {
        container.insertSubview(host, aboveSubview: target)
      } else {
        container.addSubview(host)
      }
    }
    
    host.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.deactivate(host.constraints)

    if let target = targetView, target.bounds.width > 1, target.bounds.height > 1 {
       // Match the image view exactly
      NSLayoutConstraint.activate([
        host.centerXAnchor.constraint(equalTo: target.centerXAnchor),
        host.centerYAnchor.constraint(equalTo: target.centerYAnchor),
        host.widthAnchor.constraint(equalTo: target.widthAnchor),
        host.heightAnchor.constraint(equalTo: target.heightAnchor),
      ])
    } else {
       // Fallback - center in container
      let heightMultiplier: CGFloat = tabBarOptions.showLabels ? 0.65 : 0.85
      NSLayoutConstraint.activate([
        host.centerXAnchor.constraint(equalTo: container.centerXAnchor),
        host.topAnchor.constraint(equalTo: container.topAnchor, constant: tabBarOptions.showLabels ? 6 : 0),
        host.heightAnchor.constraint(equalTo: container.heightAnchor, multiplier: heightMultiplier),
        host.widthAnchor.constraint(equalTo: host.heightAnchor),
      ])
    }
  }

  private func findIconImageView(in view: UIView) -> UIImageView? {
    if let imageView = view as? UIImageView {
      return imageView
    }
    for subview in view.subviews {
      if let imageView = findIconImageView(in: subview) {
        return imageView
      }
    }
    return nil
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

  private func removeIconHosts(forRouteKey routeKey: String) {
    let keysForRoute = iconHostEntries.compactMap { (key, entry) -> String? in
      entry.routeKey == routeKey ? key : nil
    }
    for key in keysForRoute {
      removeIconHostEntry(forKey: key)
    }
  }

  private func removeIconHostEntry(forKey key: String) {
    guard let entry = iconHostEntries.removeValue(forKey: key) else { return }
    entry.normalHost.removeFromSuperview()
    entry.normalHost.teardown()
    entry.selectedHost.removeFromSuperview()
    entry.selectedHost.teardown()
  }

  private func showNativeIcon(in button: UIView) {
    guard let imageView = findIconImageView(in: button) else { return }
    imageView.isHidden = false
    imageView.alpha = 1.0
  }

  private func clearIconHosts() {
    for (_, entry) in iconHostEntries {
      entry.normalHost.removeFromSuperview()
      entry.normalHost.teardown()
      entry.selectedHost.removeFromSuperview()
      entry.selectedHost.teardown()
    }
    iconHostEntries.removeAll()
  }

  private func updateIconHostStates() {
    guard nativeTabBarEnabled else { return }
    // Note: We no longer check for stale entries with nil buttons here.
    // Stale entries are cleaned up in refreshIconHosts via the unusedKeys mechanism.
    // This prevents premature removal of entries when UIKit is recreating button views,
    // which was causing icon blinking during tab switches.
    for (_, entry) in iconHostEntries {
      let isActive = entry.index == selectedIndex
      let activeTint = iconTintColor(isActive: true)
      let inactiveTint = iconTintColor(isActive: false)
      // Normal host shows inactive state (visible when tab is NOT selected)
      entry.normalHost.renderIcon(active: false, tintColor: inactiveTint)
      // Selected host shows active state (visible when tab IS selected)
      entry.selectedHost.renderIcon(active: true, tintColor: activeTint)
    }
  }

  private func iconTintColor(isActive: Bool) -> UIColor {
    if isActive {
      return tabBarOptions.activeTintColor ?? UIColor.systemBlue
    }
    return tabBarOptions.inactiveTintColor ?? UIColor.systemGray
  }

  private func adoptViewForNativeTabs(_ view: UIView) {
    NSLog("[RuneScreenTabs] adoptViewForNativeTabs - view: \(view), hidden: \(view.isHidden), alpha: \(view.alpha)")
    view.removeFromSuperview()
    view.frame = bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // CRITICAL: Unhide the view since UITabBarController will manage visibility
    view.isHidden = false
    view.alpha = 1.0
    NSLog("[RuneScreenTabs] adoptViewForNativeTabs - after unhide: hidden: \(view.isHidden), alpha: \(view.alpha)")
  }

  private func synchronizeTabs() {
    guard nativeTabBarEnabled else { return }
    NSLog("[RuneScreenTabs] synchronizeTabs - tabViews count: \(tabViews.count)")
    attachTabBarControllerIfNeeded()
    guard let controller = tabBarController else {
      NSLog("[RuneScreenTabs] ERROR: tabBarController is nil after attach!")
      return
    }

    let tabContentControllers = tabViews.compactMap { self.controller(for: $0) }
    NSLog("[RuneScreenTabs] Created \(tabContentControllers.count) view controllers")
    controller.setViewControllers(tabContentControllers, animated: false)
    let clamped = max(0, min(selectedIndex, tabContentControllers.count - 1))
    selectedIndex = clamped
    controller.selectedIndex = clamped
    NSLog("[RuneScreenTabs] Set selectedIndex to \(clamped)")
    updateTabBarItems()
  }

  private func controller(for view: UIView) -> RuneTabContentViewController {
    let key = ObjectIdentifier(view)
    if let existing = controllerMap[key] {
      NSLog("[RuneScreenTabs] Reusing existing controller for view \(view)")
      return existing
    }
    NSLog("[RuneScreenTabs] Creating new controller for view \(view), frame: \(view.frame), subviews: \(view.subviews.count)")
    let controller = RuneTabContentViewController(contentView: view)
    controllerMap[key] = controller
    return controller
  }

  private func updateTabBarItems() {
    guard nativeTabBarEnabled else { return }
    guard let controllers = tabBarController?.viewControllers else { return }
    for (index, controller) in controllers.enumerated() {
      guard let tabController = controller as? RuneTabContentViewController else { continue }
      let descriptor = index < tabDescriptors.count ? tabDescriptors[index] : nil
      configureTabBarItem(for: tabController, descriptor: descriptor, index: index)
    }
    applyTabBarAppearance()
    // Defer icon host refresh with triple async for label stability
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.tabBarController?.tabBar.layoutIfNeeded()
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.tabBarController?.tabBar.setNeedsLayout()
        self.tabBarController?.tabBar.layoutIfNeeded()
        DispatchQueue.main.async { [weak self] in
          self?.refreshIconHosts()
        }
      }
    }
  }

  private func configureTabBarItem(
    for controller: RuneTabContentViewController,
    descriptor: RuneNativeTabBarItem?,
    index: Int
  ) {
    let item = controller.tabBarItem ?? UITabBarItem()
    if descriptor?.hidden == true {
      item.title = ""
      item.isEnabled = false
    } else {
      item.title = descriptor?.label ?? descriptor?.routeName ?? ""
      item.isEnabled = true
    }
    item.badgeValue = descriptor?.badge
    item.badgeColor = descriptor?.badgeColor
    if let icon = descriptor?.icon {
      switch icon {
      case .descriptor(let descriptor):
        item.image = makeImage(for: descriptor)?.withRenderingMode(.alwaysTemplate)
        item.selectedImage = item.image
      case .surface:
        item.image = surfaceIconPlaceholder
        item.selectedImage = surfaceIconPlaceholder
      }
    } else {
      item.image = nil
      item.selectedImage = nil
    }
    controller.tabBarItem = item
  }

  private func makeImage(for descriptor: RuneNativeTabBarIconDescriptor) -> UIImage? {
    if let systemName = descriptor.systemName, !systemName.isEmpty {
      return UIImage(systemName: systemName)
    }
    if let assetName = descriptor.assetName, !assetName.isEmpty {
      return UIImage(named: assetName)
    }
    if let glyph = descriptor.glyph, !glyph.isEmpty {
      let size = descriptor.glyphFontSize ?? 20
      let font: UIFont
      if let family = descriptor.glyphFontFamily, let customFont = UIFont(name: family, size: size) {
        font = customFont
      } else {
        font = UIFont.systemFont(ofSize: size, weight: .medium)
      }
      let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: UIColor.white,
      ]
      let attributed = NSAttributedString(string: glyph, attributes: attributes)
      let textSize = attributed.size()
      let renderer = UIGraphicsImageRenderer(size: textSize)
      return renderer.image { _ in
        attributed.draw(at: .zero)
      }
    }
    return nil
  }

  private func applyTabBarAppearance() {
    guard nativeTabBarEnabled, let controller = tabBarController else { return }
    let appearance = UITabBarAppearance()
    appearance.configureWithDefaultBackground()
    if let blurStyle = tabBarOptions.blurEffectStyle {
      appearance.backgroundEffect = UIBlurEffect(style: blurStyle)
    }
    if let backgroundColor = tabBarOptions.backgroundColor {
      appearance.backgroundColor = backgroundColor.withAlphaComponent(0.92)
    }

    let normalColor = tabBarOptions.inactiveTintColor ?? UIColor.systemGray
    let activeColor = tabBarOptions.activeTintColor ?? UIColor.systemBlue
    let fontSize: CGFloat = tabBarOptions.showLabels ? 10 : 0.1

    configureTabItemAppearance(
      appearance.stackedLayoutAppearance,
      normalColor: normalColor,
      activeColor: activeColor,
      fontSize: fontSize,
      showLabels: tabBarOptions.showLabels
    )
    configureTabItemAppearance(
      appearance.inlineLayoutAppearance,
      normalColor: normalColor,
      activeColor: activeColor,
      fontSize: fontSize,
      showLabels: tabBarOptions.showLabels
    )
    configureTabItemAppearance(
      appearance.compactInlineLayoutAppearance,
      normalColor: normalColor,
      activeColor: activeColor,
      fontSize: fontSize,
      showLabels: tabBarOptions.showLabels
    )

    controller.tabBar.standardAppearance = appearance
    if #available(iOS 15.0, *) {
      controller.tabBar.scrollEdgeAppearance = appearance
    }
    controller.tabBar.isHidden = !tabBarOptions.visible
  }

  private func configureTabItemAppearance(
    _ itemAppearance: UITabBarItemAppearance,
    normalColor: UIColor,
    activeColor: UIColor,
    fontSize: CGFloat,
    showLabels: Bool
  ) {
    let normalAttributes: [NSAttributedString.Key: Any] = [
      .foregroundColor: normalColor,
      .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
    ]
    let selectedAttributes: [NSAttributedString.Key: Any] = [
      .foregroundColor: activeColor,
      .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
    ]

    itemAppearance.normal.iconColor = normalColor
    itemAppearance.normal.titleTextAttributes = normalAttributes
    itemAppearance.selected.iconColor = activeColor
    itemAppearance.selected.titleTextAttributes = selectedAttributes

    if !showLabels {
      let offset = UIOffset(horizontal: 0, vertical: 20)
      itemAppearance.normal.titlePositionAdjustment = offset
      itemAppearance.selected.titlePositionAdjustment = offset
    } else {
      itemAppearance.normal.titlePositionAdjustment = .zero
      itemAppearance.selected.titlePositionAdjustment = .zero
    }
  }

  private func attachTabBarControllerIfNeeded() {
    guard nativeTabBarEnabled else { return }
    guard tabBarController == nil else { return }
    guard let parentVC = findParentViewController() else { return }

    let controller = UITabBarController()
    controller.delegate = self
    parentVC.addChild(controller)
    controller.view.frame = bounds
    controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(controller.view)
    controller.didMove(toParent: parentVC)

    hostingController = parentVC
    tabBarController = controller
    applyTabBarAppearance()
    // Defer icon host setup with triple async to ensure tab bar labels are fully rendered
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.tabBarController?.tabBar.layoutIfNeeded()
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.tabBarController?.tabBar.setNeedsLayout()
        self.tabBarController?.tabBar.layoutIfNeeded()
        DispatchQueue.main.async { [weak self] in
          self?.refreshIconHosts()
        }
      }
    }
  }

  private func detachTabBarController() {
    guard let controller = tabBarController else { return }
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
    tabBarController = nil
    hostingController = nil
    clearIconHosts()
    removeTransitionOverlay()
  }

  private func updateTabVisibility() {
    guard !nativeTabBarEnabled else { return }
    selectedIndex = clampIndex(selectedIndex)
    for (index, view) in tabViews.enumerated() {
      let visible = index == selectedIndex
      view.isHidden = !visible
      if visible {
        view.frame = bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      }
    }
  }

  private func clampIndex(_ index: Int) -> Int {
    guard !tabViews.isEmpty else { return 0 }
    return max(0, min(index, tabViews.count - 1))
  }

  private func findParentViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController {
        return controller
      }
      responder = next
    }
    return nil
  }

  private func dispatchEvent(name: String, payload: NSDictionary?) {
    guard let manager = manager, let node = node else { return }
    let selector = NSSelectorFromString("rune_dispatchEvent:payload:toNode:")
    guard manager.responds(to: selector), let method = manager.method(for: selector) else {
      return
    }
    typealias Imp = @convention(c) (AnyObject, Selector, NSString, NSDictionary?, SNNode) -> Void
    let function = unsafeBitCast(method, to: Imp.self)
    function(manager, selector, name as NSString, payload, node)
  }
}

private final class NativeTabIconHostEntry {
  let normalHost: RuneTabIconHostView
  let selectedHost: RuneTabIconHostView
  var index: Int
  var routeKey: String
  weak var normalContainer: UIView?
  weak var selectedContainer: UIView?

  init(normalHost: RuneTabIconHostView, selectedHost: RuneTabIconHostView, index: Int, routeKey: String) {
    self.normalHost = normalHost
    self.selectedHost = selectedHost
    self.index = index
    self.routeKey = routeKey
  }
}

private extension RuneNativeTabBarItem {
  init?(dictionary: [String: Any]) {
    guard
      let key = dictionary["key"] as? String,
      let routeName = dictionary["routeName"] as? String
    else {
      return nil
    }
    self.key = key
    self.routeName = routeName
    self.label = dictionary["label"] as? String
    if let badgeValue = dictionary["badge"] {
      self.badge = String(describing: badgeValue)
    } else {
      self.badge = nil
    }
    if let badgeColor = dictionary["badgeColor"] as? String {
      self.badgeColor = UIColor.rune_color(from: badgeColor)
    }
    self.hidden = dictionary["hidden"] as? Bool ?? false
    if let iconDict = dictionary["icon"] as? [String: Any],
       let type = iconDict["type"] as? String {
      if type == "surface", let routeKey = iconDict["routeKey"] as? String {
        self.icon = .surface(routeKey: routeKey)
      } else if type == "descriptor" {
        var descriptor = RuneNativeTabBarIconDescriptor()
        descriptor.systemName = iconDict["systemName"] as? String
        descriptor.assetName = iconDict["assetName"] as? String
        descriptor.uri = iconDict["uri"] as? String
        descriptor.glyph = iconDict["glyph"] as? String
        descriptor.glyphFontFamily = iconDict["glyphFontFamily"] as? String
        if let fontSize = iconDict["glyphFontSize"] as? NSNumber {
          descriptor.glyphFontSize = CGFloat(truncating: fontSize)
        }
        self.icon = .descriptor(descriptor)
      }
    }
  }
}

private extension UIBlurEffect.Style {
  init?(string: String) {
    switch string {
    case "systemUltraThinMaterial":
      self = .systemUltraThinMaterial
    case "systemThinMaterial":
      self = .systemThinMaterial
    case "systemChromeMaterial":
      self = .systemChromeMaterial
    case "systemMaterial":
      self = .systemMaterial
    default:
      return nil
    }
  }
}
