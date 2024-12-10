#if DEBUG
  import UIKit

  /// Visual indicator for HMR bundle loading and updates
  public class RuneDevStatusBar: UIView {
    private let label = UILabel()
    private let activityIndicator = UIActivityIndicatorView(style: .white)
    private var hideTimer: Timer?
    private static let barHeight: CGFloat = 32

    public override init(frame: CGRect) {
      super.init(frame: frame)
      setup()
    }

    required init?(coder: NSCoder) {
      super.init(coder: coder)
      setup()
    }

    private func setup() {
      // Container styling
      backgroundColor = .systemBlue
      alpha = 0
      layer.zPosition = .greatestFiniteMagnitude

      // NO AUTO LAYOUT - just add subviews
      label.textColor = .white
      label.font = .systemFont(ofSize: 12, weight: .medium)
      label.textAlignment = .center
      addSubview(label)

      activityIndicator.hidesWhenStopped = true
      addSubview(activityIndicator)
    }

    public override func layoutSubviews() {
      super.layoutSubviews()

      // Manual layout - simple and works!
      let centerY = bounds.height / 2

      // Center the label
      label.sizeToFit()
      label.center = CGPoint(x: bounds.width / 2, y: centerY)

      // Position activity indicator to the left of label
      activityIndicator.sizeToFit()
      activityIndicator.center = CGPoint(
        x: label.frame.minX - activityIndicator.bounds.width / 2 - 8,
        y: centerY
      )
    }

    /// Show "Bundle Loading..." indicator at bottom
    public func showBundleLoading() {
      print("[StatusBar] showBundleLoading called")
      cancelHideTimer()
      backgroundColor = .systemOrange
      label.text = "Loading Bundle..."
      activityIndicator.startAnimating()
      animateIn(position: .bottom)
    }

    /// Show "Bundle Loaded" success message at bottom
    public func showBundleLoaded() {
      print("[StatusBar] showBundleLoaded called")
      cancelHideTimer()
      backgroundColor = .systemGreen
      label.text = "Bundle Loaded"
      activityIndicator.stopAnimating()
      animateIn(position: .bottom)

      // Auto-hide after 2 seconds
      hideTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
        print("[StatusBar] Auto-hide timer fired")
        self?.hide()
      }
    }

    /// Show "Update Available" notification at top
    public func showUpdateAvailable() {
      print("[StatusBar] showUpdateAvailable called")
      cancelHideTimer()
      backgroundColor = .systemBlue
      label.text = "Update Available"
      activityIndicator.stopAnimating()
      animateIn(position: .top)

      // Auto-hide after 1.5 seconds
      hideTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in
        print("[StatusBar] Auto-hide timer fired for Update Available")
        self?.hide()
      }
    }

    /// Show "Updating..." indicator at top
    public func showUpdating() {
      print("[StatusBar] showUpdating called")
      cancelHideTimer()
      backgroundColor = .systemBlue
      label.text = "Updating..."
      activityIndicator.startAnimating()
      animateIn(position: .top)
    }

    /// Show error message at bottom
    public func showError(_ message: String) {
      print("[StatusBar] showError called: \(message)")
      cancelHideTimer()
      backgroundColor = .systemRed
      label.text = message
      activityIndicator.stopAnimating()
      animateIn(position: .bottom)

      // Auto-hide after 4 seconds
      hideTimer = Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { [weak self] _ in
        print("[StatusBar] Auto-hide timer fired for error")
        self?.hide()
      }
    }

    /// Hide the status bar
    public func hide() {
      print("[StatusBar] hide called")
      cancelHideTimer()
      UIView.animate(
        withDuration: 0.3,
        animations: {
          self.alpha = 0
        })
    }

    private func cancelHideTimer() {
      hideTimer?.invalidate()
      hideTimer = nil
    }

    private func animateIn(position: Position) {
      guard let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow }) else {
        return
      }

      // Setup view if not already in window
      if superview == nil {
        window.addSubview(self)

        // Use simple frame-based layout
        let safeArea = window.safeAreaInsets
        let width = window.bounds.width

        // Start at bottom position
        let bottomY = window.bounds.height - Self.barHeight - safeArea.bottom
        frame = CGRect(x: 0, y: bottomY, width: width, height: Self.barHeight)
      }

      // Calculate positions
      let safeArea = window.safeAreaInsets
      let topY = safeArea.top
      let bottomY = window.bounds.height - Self.barHeight - safeArea.bottom

      let targetY = position == .top ? topY : bottomY

      // Animate to position
      UIView.animate(withDuration: 0.3) {
        self.frame.origin.y = targetY
        self.alpha = 1
      }
    }

    private enum Position {
      case top
      case bottom
    }
  }
#endif
