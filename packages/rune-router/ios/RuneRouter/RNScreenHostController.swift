import UIKit

final class RNScreenHostController: UIViewController {
  let routeKey: String
  let routeName: String
  private var params: [String: Any]?
  private var appliedOptions: [String: Any]?
  private weak var surfaceView: UIView?

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
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
  }

  func updateParams(_ params: [String: Any]?) {
    self.params = params
  }

  func attachSurfaceView(_ surface: UIView) {
    surface.removeFromSuperview()
    surface.frame = view.bounds
    surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(surface)
    surfaceView = surface
    view.setNeedsLayout()
    view.layoutIfNeeded()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    surfaceView?.frame = view.bounds
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
    if let tintHex = options["headerTintColor"] as? String {
      navigationController?.navigationBar.tintColor = UIColor(hex: tintHex)
    }
  }
}

extension UIColor {
  fileprivate convenience init?(hex: String) {
    var formatted = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if formatted.hasPrefix("#") {
      formatted.removeFirst()
    }
    guard formatted.count == 6,
      let value = Int(formatted, radix: 16)
    else { return nil }
    let red = CGFloat((value >> 16) & 0xFF) / 255.0
    let green = CGFloat((value >> 8) & 0xFF) / 255.0
    let blue = CGFloat(value & 0xFF) / 255.0
    self.init(red: red, green: green, blue: blue, alpha: 1)
  }
}
