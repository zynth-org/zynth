import UIKit

public extension Notification.Name {
  static let runeReloadRequested = Notification.Name("runeReloadRequested")
}

@objc public final class DevRedBox: NSObject {
  private var window: UIWindow?
  private var controller: RedBoxViewController?

  @objc(showWithTitle:message:stack:)
  public static func show(title: String, message: String, stack: String?) {
    let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
    DispatchQueue.main.async {
      shared.present(title: title, message: text.isEmpty ? "Unknown Error" : text, stack: stack)
    }
  }

  @objc public static func dismiss() {
    DispatchQueue.main.async {
      shared.hide()
    }
  }

  private static let shared = DevRedBox()

  private func present(title: String, message: String, stack: String?) {
    if controller == nil {
      createOverlay()
    }
    controller?.update(title: title, message: message, stack: stack)
    window?.isHidden = false
  }

  private func hide() {
    window?.isHidden = true
    controller = nil
    window = nil
  }

  private func createOverlay() {
    let redBoxController = RedBoxViewController()
    redBoxController.onDismiss = { [weak self] in
      self?.hide()
    }
    redBoxController.onReload = {
      NotificationCenter.default.post(name: .runeReloadRequested, object: nil)
    }

    let overlayWindow = UIWindow(frame: UIScreen.main.bounds)
    overlayWindow.windowLevel = .alert + 1
    overlayWindow.rootViewController = redBoxController
    overlayWindow.isHidden = false

    controller = redBoxController
    window = overlayWindow
  }
}

final class RedBoxViewController: UIViewController {
  var onDismiss: (() -> Void)?
  var onReload: (() -> Void)?

  private let container = UIView()
  private let titleLabel = UILabel()
  private let messageView = UITextView()
  private let stackView = UITextView()
  private let reloadButton = UIButton(type: .system)
  private let dismissButton = UIButton(type: .system)

  override func viewDidLoad() {
    super.viewDidLoad()

    view.backgroundColor = UIColor(white: 0, alpha: 0.6)

    container.backgroundColor = UIColor(red: 0.6, green: 0, blue: 0, alpha: 0.95)
    container.layer.cornerRadius = 16
    container.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(container)

    titleLabel.font = UIFont.boldSystemFont(ofSize: 20)
    titleLabel.textColor = .white
    titleLabel.numberOfLines = 0
    titleLabel.translatesAutoresizingMaskIntoConstraints = false

    messageView.backgroundColor = .clear
    messageView.textColor = .white
    messageView.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
    messageView.isEditable = false
    messageView.isScrollEnabled = false
    messageView.translatesAutoresizingMaskIntoConstraints = false

    stackView.backgroundColor = UIColor(white: 1, alpha: 0.1)
    stackView.textColor = UIColor(white: 0.9, alpha: 1)
    stackView.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    stackView.isEditable = false
    stackView.isScrollEnabled = true
    stackView.layer.cornerRadius = 8
    stackView.translatesAutoresizingMaskIntoConstraints = false

    reloadButton.setTitle("Reload", for: .normal)
    reloadButton.setTitleColor(.white, for: .normal)
    reloadButton.titleLabel?.font = UIFont.boldSystemFont(ofSize: 16)
    reloadButton.translatesAutoresizingMaskIntoConstraints = false
    reloadButton.addTarget(self, action: #selector(handleReload), for: .touchUpInside)

    dismissButton.setTitle("Dismiss", for: .normal)
    dismissButton.setTitleColor(UIColor(white: 0.9, alpha: 1), for: .normal)
    dismissButton.translatesAutoresizingMaskIntoConstraints = false
    dismissButton.addTarget(self, action: #selector(handleDismiss), for: .touchUpInside)

    container.addSubview(titleLabel)
    container.addSubview(messageView)
    container.addSubview(stackView)
    container.addSubview(reloadButton)
    container.addSubview(dismissButton)

    NSLayoutConstraint.activate([
      container.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      container.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      container.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),

      titleLabel.topAnchor.constraint(equalTo: container.topAnchor, constant: 20),
      titleLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
      titleLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -20),

      messageView.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
      messageView.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
      messageView.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -20),

      stackView.topAnchor.constraint(equalTo: messageView.bottomAnchor, constant: 12),
      stackView.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
      stackView.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -20),
      stackView.heightAnchor.constraint(greaterThanOrEqualToConstant: 120),

      reloadButton.topAnchor.constraint(equalTo: stackView.bottomAnchor, constant: 16),
      reloadButton.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
      reloadButton.heightAnchor.constraint(equalToConstant: 36),

      dismissButton.centerYAnchor.constraint(equalTo: reloadButton.centerYAnchor),
      dismissButton.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -20),
      dismissButton.heightAnchor.constraint(equalToConstant: 36),

      container.bottomAnchor.constraint(equalTo: reloadButton.bottomAnchor, constant: 20)
    ])
  }

  func update(title: String, message: String, stack: String?) {
    titleLabel.text = title
    messageView.text = message
    if let stack = stack, !stack.isEmpty {
      stackView.text = stack
      stackView.isHidden = false
    } else {
      stackView.text = nil
      stackView.isHidden = true
    }
  }

  @objc private func handleReload() {
    onReload?()
    DevRedBox.dismiss()
  }

  @objc private func handleDismiss() {
    onDismiss?()
  }
}
