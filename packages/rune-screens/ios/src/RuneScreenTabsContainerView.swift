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
    detachTabBarController()
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
    if nativeTabBarEnabled {
      controllerMap.removeValue(forKey: ObjectIdentifier(view))
      synchronizeTabs()
    } else {
      view.removeFromSuperview()
      updateTabVisibility()
    }
  }

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
      
      // Check if we're already switching to this index
      if let pending = pendingTabSwitch, pending == clamped {
        NSLog("[RuneScreenTabs] Already switching to \(clamped), ignoring duplicate request")
        return
      }
      
      if controller.selectedIndex != clamped {
        // Defer tab switch until content is ready to prevent white flash
        deferTabSwitch(to: clamped)
      }
      updateIconHostStates()
    } else {
      updateTabVisibility()
    }
  }

  public func setTabAnimationType(_ value: NSString?) {
    // No-op for now. Tab animations are handled by UITabBarController.
  }
  
  private func deferTabSwitch(to index: Int) {
    guard let controller = tabBarController else { return }
    guard index < tabViews.count else { return }
    
    let targetView = tabViews[index]
    NSLog("[RuneScreenTabs] deferTabSwitch to index \(index), checking content readiness")
    
    // Cancel any pending switch
    tabSwitchWorkItem?.cancel()
    pendingTabSwitch = index
    
    let isReady = isContentReady(targetView)
    NSLog("[RuneScreenTabs] Target view ready: \(isReady), subviews: \(targetView.subviews.count)")
    
    // ALWAYS wait a minimum amount to ensure styles are applied
    let minimumDelay: TimeInterval = 0.05 // 3 frames at 60fps
    var attempts = 0
    let maxAttempts = 12
    let startTime = Date()
    
    func checkAndSwitch() {
      attempts += 1
      guard pendingTabSwitch == index else {
        NSLog("[RuneScreenTabs] Pending switch cancelled")
        return
      }
      
      let elapsed = Date().timeIntervalSince(startTime)
      let contentReady = isContentReady(targetView)
      
      // Wait for minimum delay AND content to be ready
      let shouldSwitch = elapsed >= minimumDelay && contentReady
      
      if shouldSwitch {
        NSLog("[RuneScreenTabs] Content ready after \(attempts) checks (\(String(format: "%.3f", elapsed))s), switching now")
        performTabSwitch(to: index)
      } else if attempts < maxAttempts {
        // Check more frequently at first, then back off
        let delay: TimeInterval
        if elapsed < minimumDelay {
          delay = 0.016 // Check every frame until minimum delay passed
        } else if attempts < 5 {
          delay = 0.03 // 2 frames
        } else {
          delay = 0.05 // 3 frames
        }
        
        let workItem = DispatchWorkItem { checkAndSwitch() }
        tabSwitchWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
      } else {
        // Safety timeout
        NSLog("[RuneScreenTabs] WARNING: Forcing switch after \(String(format: "%.3f", elapsed))s, contentReady: \(contentReady)")
        performTabSwitch(to: index)
      }
    }
    
    NSLog("[RuneScreenTabs] Starting deferred switch with minimum delay \(minimumDelay)s")
    let initialWorkItem = DispatchWorkItem { checkAndSwitch() }
    tabSwitchWorkItem = initialWorkItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.016, execute: initialWorkItem)
  }
  
  private func isContentReady(_ view: UIView) -> Bool {
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
    return substantialViewCount >= 2
  }
  
  private func performTabSwitch(to index: Int) {
    guard let controller = tabBarController else { return }
    guard pendingTabSwitch == index else { return }
    
    pendingTabSwitch = nil
    tabSwitchWorkItem = nil
    
    NSLog("[RuneScreenTabs] performTabSwitch to index \(index)")
    isApplyingNativeSelection = true
    
    // Disable implicit animations to prevent cross-fade effect
    UIView.performWithoutAnimation {
      controller.selectedIndex = index
    }
    
    isApplyingNativeSelection = false
  }

  @objc(setTabBarOptionsFromDictionary:)
  public func setTabBarOptions(from dictionary: NSDictionary?) {
    var options = RuneNativeTabBarOptions.default
    if let dict = dictionary as? [String: Any] {
      if let visible = dict["visible"] as? Bool {
        options.visible = visible
      }
      if let backgroundColor = dict["backgroundColor"] as? String {
        options.backgroundColor = UIColor.rune_color(from: backgroundColor)
      }
      if let activeTint = dict["activeTintColor"] as? String {
        options.activeTintColor = UIColor.rune_color(from: activeTint)
      }
      if let inactiveTint = dict["inactiveTintColor"] as? String {
        options.inactiveTintColor = UIColor.rune_color(from: inactiveTint)
      }
      if let showLabels = dict["showLabels"] as? Bool {
        options.showLabels = showLabels
      }
      if let blurStyle = dict["blurEffectStyle"] as? String {
        options.blurEffectStyle = UIBlurEffect.Style(string: blurStyle)
      }
    }
    tabBarOptions = options
  }

  @objc(setTabItemsFromArray:)
  public func setTabItems(from array: NSArray?) {
    guard let rawItems = array as? [[String: Any]] else {
      tabDescriptors = []
      return
    }
    tabDescriptors = rawItems.compactMap { RuneNativeTabBarItem(dictionary: $0) }
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
      for view in tabViews where view.superview !== self {
        addSubview(view)
      }
      clearIconHosts()
      updateTabVisibility()
    }
  }

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
    // Check if content is ready
    let targetView = tabViews[targetIndex]
    if isContentReady(targetView) {
        NSLog("[RuneScreenTabs] Content ready for index \(targetIndex), allowing immediate switch")
        selectedIndex = targetIndex
        updateIconHostStates()
        
        // Notify JS of the selection
        dispatchEvent(name: "onNativeTabSelect", payload: ["index": targetIndex] as NSDictionary)
        
        return true
    } else {
        NSLog("[RuneScreenTabs] Content NOT ready for index \(targetIndex), deferring switch")
        selectedIndex = targetIndex
        updateIconHostStates()
        
        // Notify JS of the selection
        dispatchEvent(name: "onNativeTabSelect", payload: ["index": targetIndex] as NSDictionary)
        
        // Start deferred switch
        deferTabSwitch(to: targetIndex)
        
        // Return false to prevent immediate switch by UITabBarController (avoids white flash)
        return false
    }
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
    let buttons = collectTabButtons(in: tabBar)
    // NSLog("[RuneScreenTabs] refreshIconHosts: Found \(items.count) items and \(buttons.count) buttons")

    if buttons.isEmpty {
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

    for (position, button) in buttons.enumerated() {
      guard let (item, itemIndex) = resolveTabBarItem(
        for: button,
        items: items,
        itemsByTitle: itemsByTitle,
        fallbackIndex: position,
        itemIndexMap: itemIndexMap
      ) else {
        // NSLog("[RuneScreenTabs] Skipping button at index \(position): Could not resolve item")
        continue
      }

      guard itemIndex < tabDescriptors.count else {
        // NSLog("[RuneScreenTabs] Skipping button at index \(position): Item index \(itemIndex) out of bounds")
        continue
      }

      let descriptor = tabDescriptors[itemIndex]
      let descriptorRouteKey = descriptor.key
      
      // NSLog("[RuneScreenTabs] Button \(position) -> Item \(itemIndex) (\(descriptor.label ?? "no-label"))")

      if descriptor.hidden {
        showNativeIcon(in: button)
        removeIconHostEntry(forKey: iconHostKey(routeKey: descriptorRouteKey, button: button))
        continue
      }
      
      guard let icon = descriptor.icon else {
        showNativeIcon(in: button)
        removeIconHostEntry(forKey: iconHostKey(routeKey: descriptorRouteKey, button: button))
        continue
      }
      
      let imageView = findIconImageView(in: button)

      switch icon {
      case .descriptor:
        showNativeIcon(in: button)
        removeIconHostEntry(forKey: iconHostKey(routeKey: descriptorRouteKey, button: button))
      case .surface(let routeKey):
        guard let targetView = imageView else {
            //  NSLog("[RuneScreenTabs] Failed to find UIImageView for button \(position)")
             continue
        }
        
        let key = iconHostKey(routeKey: routeKey, button: button)
        activeKeys.insert(key)
        
        // CRITICAL: Ensure button has completed layout before hiding image view.
        // Force a full layout cycle to ensure labels have their correct frames.
        button.setNeedsLayout()
        button.layoutIfNeeded()
        
        // Find and protect label visibility BEFORE hiding image view
        func findLabel(in view: UIView) -> UILabel? {
            if let label = view as? UILabel { return label }
            for sub in view.subviews {
                if let found = findLabel(in: sub) { return found }
            }
            return nil
        }
        
        if let label = findLabel(in: button) {
            // Force label to be visible and maintain its properties
            label.isHidden = false
            label.alpha = 1.0
            // Ensure label doesn't get clipped
            label.clipsToBounds = false
        }
        
        // Only hide image view AFTER labels are protected and layout is stable
        targetView.isHidden = true
        targetView.alpha = 1.0
        
        // NSLog("[RuneScreenTabs] TargetView frame: \(targetView.frame)")
        
        let entry: NativeTabIconHostEntry
        if let existing = iconHostEntries[key] {
          entry = existing
        } else {
          // NSLog("[RuneScreenTabs] Creating new Host for \(routeKey)")
          let host = RuneTabIconHostView()
          entry = NativeTabIconHostEntry(host: host, index: itemIndex, routeKey: routeKey, button: button)
          iconHostEntries[key] = entry
        }
        
        entry.index = itemIndex
        entry.routeKey = routeKey
        entry.button = button
        
        // Configure and Attach
        entry.host.configure(routeKey: routeKey, runtime: runtime)
        attachIconHost(entry.host, to: button, targetView: targetView)
        button.layoutIfNeeded()
        
        let tint = iconTintColor(isActive: itemIndex == selectedIndex)
        entry.host.renderIcon(active: itemIndex == selectedIndex, tintColor: tint)
      }
    }

    let unusedKeys = iconHostEntries.keys.filter { !activeKeys.contains($0) }
    for key in unusedKeys {
      removeIconHostEntry(forKey: key)
    }
    updateIconHostStates()
  }

  private func collectTabButtons(in view: UIView) -> [UIView] {
    // Robust collection matching rune-router: checks for "Tab" string OR if it's a generic UIControl
    var result: [UIView] = []
    func walk(_ node: UIView) {
       if let control = node as? UIControl {
          let className = String(describing: type(of: control))
          if className.contains("Tab") || control is UIControl {
              result.append(control)
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
      container.addSubview(host)
      // Send to back IMMEDIATELY to ensure it doesn't interfere with labels
      container.sendSubviewToBack(host)
    } else {
      // Even if already attached, ensure it's at the back
      container.sendSubviewToBack(host)
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
       // Fallback
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

  private func iconHostKey(routeKey: String, button: UIView) -> String {
    return "\(routeKey)-\(ObjectIdentifier(button).hashValue)"
  }

  private func removeIconHostEntry(forKey key: String) {
    guard let entry = iconHostEntries.removeValue(forKey: key) else { return }
    entry.host.removeFromSuperview()
    entry.host.teardown()
  }

  private func showNativeIcon(in button: UIView) {
    guard let imageView = findIconImageView(in: button) else { return }
    imageView.isHidden = false
    imageView.alpha = 1.0
  }

  private func clearIconHosts() {
    for (_, entry) in iconHostEntries {
      entry.host.removeFromSuperview()
      entry.host.teardown()
    }
    iconHostEntries.removeAll()
  }

  private func updateIconHostStates() {
    guard nativeTabBarEnabled else { return }
    let staleKeys = iconHostEntries.compactMap { (key, entry) -> String? in
      return entry.button == nil ? key : nil
    }
    for key in staleKeys {
      removeIconHostEntry(forKey: key)
    }
    for (_, entry) in iconHostEntries {
      let isActive = entry.index == selectedIndex
      let tint = iconTintColor(isActive: isActive)
      entry.host.renderIcon(active: isActive, tintColor: tint)
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
  let host: RuneTabIconHostView
  var index: Int
  var routeKey: String
  weak var button: UIView?

  init(host: RuneTabIconHostView, index: Int, routeKey: String, button: UIView?) {
    self.host = host
    self.index = index
    self.routeKey = routeKey
    self.button = button
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
