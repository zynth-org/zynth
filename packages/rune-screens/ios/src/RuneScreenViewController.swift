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

    let appearance = UINavigationBarAppearance()
    if options.isTransparent {
      appearance.configureWithTransparentBackground()
    } else if let backgroundColor = options.backgroundColor {
      appearance.configureWithOpaqueBackground()
      appearance.backgroundColor = backgroundColor
    } else {
      appearance.configureWithDefaultBackground()
    }
    appearance.shadowColor = nil

    let titleColor = options.titleColor ?? UIColor.label
    appearance.titleTextAttributes = [
      .foregroundColor: titleColor,
    ]
    appearance.largeTitleTextAttributes = [
      .foregroundColor: titleColor,
    ]

    navigationItem.standardAppearance = appearance
    navigationItem.scrollEdgeAppearance = appearance
    navigationItem.compactAppearance = appearance

    if let tintColor = options.tintColor {
      navigationController?.navigationBar.tintColor = tintColor
    } else {
      navigationController?.navigationBar.tintColor = nil
    }
    updateHeaderRightItems()
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
    let style: UIBarButtonItem.Style = options.style == "done" ? .done : .plain
    let title = options.title ?? (style == .done ? "Done" : "More")
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
