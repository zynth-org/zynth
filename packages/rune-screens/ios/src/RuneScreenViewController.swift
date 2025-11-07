import UIKit

final class RuneScreenViewController: UIViewController {
  let screenView: RuneScreenView
  private var rightAccessoryHost: RuneScreenHeaderAccessoryHostView?
  private lazy var modalCloseButton = UIBarButtonItem(
    barButtonSystemItem: .close,
    target: self,
    action: #selector(handleModalCloseButtonPress)
  )
  private(set) var usesNativeZoomTransition = false

  init(screenView: RuneScreenView) {
    self.screenView = screenView
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func loadView() {
    view = screenView
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    applyHeaderOptions()
    updatePreferredTransitionConfiguration()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    applyHeaderOptions()
    updatePreferredTransitionConfiguration()
    screenView.notifyWillAppear()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    screenView.notifyDidAppear()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    screenView.notifyWillDisappear()
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    screenView.notifyDidDisappear()
  }
  
  deinit {
    rightAccessoryHost?.teardown()
  }

  func applyHeaderOptions() {
    let options = screenView.headerOptions
    navigationItem.title = options.title
    navigationItem.prompt = options.subtitle
    navigationItem.largeTitleDisplayMode = options.prefersLargeTitle ? .automatic : .never
    updateBackItems(using: options)
    applyUserInterfaceStyle(options.userInterfaceStyle)

    let appearance = makeHeaderAppearance(using: options)

    navigationItem.standardAppearance = appearance
    navigationItem.scrollEdgeAppearance = appearance
    navigationItem.compactAppearance = appearance

    updateHeaderRightItems()
    applyHeaderTint(using: options)
  }

  private func makeHeaderAppearance(using options: RuneScreenHeaderOptions) -> UINavigationBarAppearance {
    let appearance = UINavigationBarAppearance()
    if options.headerStyle == .liquidGlass {
      appearance.configureWithTransparentBackground()
    } else if options.isTransparent {
      appearance.configureWithTransparentBackground()
    } else if let blurStyle = blurEffectStyle(from: options.blurEffect) {
      appearance.configureWithTransparentBackground()
      appearance.backgroundEffect = UIBlurEffect(style: blurStyle)
      appearance.backgroundColor = options.backgroundColor
    } else if let backgroundColor = options.backgroundColor {
      appearance.configureWithOpaqueBackground()
      appearance.backgroundColor = backgroundColor
    } else {
      appearance.configureWithDefaultBackground()
    }
    if !options.shadowVisible {
      appearance.shadowColor = .clear
    }

    let titleColor = options.titleColor ?? UIColor.label
    appearance.titleTextAttributes = [
      .foregroundColor: titleColor,
    ]
    appearance.largeTitleTextAttributes = [
      .foregroundColor: titleColor,
    ]
    return appearance
  }

  private func applyUserInterfaceStyle(_ style: String?) {
    guard #available(iOS 13.0, *) else { return }
    switch style?.lowercased() {
    case "dark":
      overrideUserInterfaceStyle = .dark
    case "light":
      overrideUserInterfaceStyle = .light
    default:
      overrideUserInterfaceStyle = .unspecified
    }
  }

  private func blurEffectStyle(from value: String?) -> UIBlurEffect.Style? {
    guard let value else { return nil }
    switch value {
    case "systemUltraThin":
      return .systemUltraThinMaterial
    case "systemThin":
      return .systemThinMaterial
    case "systemChromatic":
      if #available(iOS 15.0, *) {
        return .systemChromeMaterial
      }
      return .systemMaterial
    case "systemUltraThinMaterial":
      return .systemUltraThinMaterial
    case "systemThinMaterial":
      return .systemThinMaterial
    case "systemChromeMaterial":
      if #available(iOS 15.0, *) {
        return .systemChromeMaterial
      }
      return .systemMaterial
    case "systemMaterial":
      return .systemMaterial
    default:
      return nil
    }
  }

  private func applyHeaderTint(using options: RuneScreenHeaderOptions) {
    if options.headerStyle == .liquidGlass {
      navigationController?.navigationBar.tintColor = nil
      let tintColor = options.tintColor
      navigationItem.rightBarButtonItem?.tintColor = tintColor
      navigationItem.leftBarButtonItem?.tintColor = tintColor
      modalCloseButton.tintColor = tintColor
    } else {
      navigationController?.navigationBar.tintColor = options.tintColor
      navigationItem.rightBarButtonItem?.tintColor = nil
      navigationItem.leftBarButtonItem?.tintColor = nil
      modalCloseButton.tintColor = nil
    }
  }

  private func updateBackItems(using options: RuneScreenHeaderOptions) {
    if screenView.animationType == .modal {
      navigationItem.hidesBackButton = true
      guard
        options.isBackVisible,
        let nav = navigationController,
        let index = nav.viewControllers.firstIndex(where: { $0 === self }),
        index > 0
      else {
        navigationItem.leftBarButtonItem = nil
        return
      }
      navigationItem.leftBarButtonItem = modalCloseButton
      return
    }

    navigationItem.leftBarButtonItem = nil
    navigationItem.hidesBackButton = !options.isBackVisible
  }

  private func updateHeaderRightItems() {
    if let accessory = screenView.headerOptions.rightAccessory {
      let host = rightAccessoryHost ?? RuneScreenHeaderAccessoryHostView()
      host.configure(with: accessory, screenView: screenView)
      navigationItem.rightBarButtonItem = UIBarButtonItem(customView: host)
      rightAccessoryHost = host
      return
    }

    rightAccessoryHost?.teardown()
    rightAccessoryHost = nil

    if let buttonOptions = screenView.headerOptions.rightButton {
      navigationItem.rightBarButtonItem = makeRightBarButton(from: buttonOptions)
    } else {
      navigationItem.rightBarButtonItem = nil
    }
  }

  private func makeRightBarButton(from options: RuneScreenHeaderButtonOptions) -> UIBarButtonItem {
    if options.systemItem == "close" {
      return UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(handleHeaderRightButtonPress))
    }
    let style: UIBarButtonItem.Style
    switch options.style {
    case "done":
      style = .done
    case "prominent":
      if #available(iOS 26.0, *) {
        style = .prominent
      } else {
        style = .done
      }
    default:
      style = .plain
    }
    let usesDoneTitle = options.style == "done" || options.style == "prominent"
    let title = options.title ?? (usesDoneTitle ? "Done" : "More")
    let item = UIBarButtonItem(title: title, style: style, target: self, action: #selector(handleHeaderRightButtonPress))
    return item
  }

  @objc private func handleHeaderRightButtonPress() {
    screenView.notifyNativeHeaderRightPress()
  }

  @objc private func handleModalCloseButtonPress() {
    navigationController?.popViewController(animated: true)
  }

  func updatePreferredTransitionConfiguration() {
    guard screenView.animationType == .zoom else {
      resetPreferredTransitionIfNeeded()
      return
    }

    if #available(iOS 18.0, *) {
      usesNativeZoomTransition = true
      preferredTransition = .zoom { _ in
        return nil
      }
    } else {
      usesNativeZoomTransition = false
    }
  }

  private func resetPreferredTransitionIfNeeded() {
    if #available(iOS 18.0, *), usesNativeZoomTransition {
      preferredTransition = nil
    }
    usesNativeZoomTransition = false
  }
}
