import UIKit

final class RuneScreenViewController: UIViewController {
  let screenView: RuneScreenView
  private var rightAccessoryHost: RuneScreenHeaderAccessoryHostView?

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
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    applyHeaderOptions()
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
    navigationItem.hidesBackButton = !options.isBackVisible
    navigationItem.largeTitleDisplayMode = options.prefersLargeTitle ? .automatic : .never

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
}
