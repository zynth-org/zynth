import ZynthKit
import UIKit

final class ZynthTabIconHostView: UIView {
  private let contentView = UIView()
  private weak var runtime: ZynthRuntime?
  private var surfaceId: Int32?
  private var routeKey: String?
  private var renderToken = 0
  private let renderQueue = DispatchQueue(label: "dev.zynth.tabIcon.render", qos: .userInitiated)

  override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  private func commonInit() {
    backgroundColor = .clear
    isUserInteractionEnabled = false
    contentView.backgroundColor = .clear
    contentView.frame = bounds
    contentView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(contentView)
  }

  override var intrinsicContentSize: CGSize {
    return CGSize(width: 24, height: 24)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    contentView.frame = bounds
  }

  func configure(routeKey: String, runtime: ZynthRuntime?) {
    guard routeKey != self.routeKey else { return }
    teardown()
    self.routeKey = routeKey
    self.runtime = runtime
    _ = ensureSurface()
  }

  func renderIcon(active: Bool, tintColor: UIColor) {
    guard let routeKey, let runtime = runtime, let surfaceId = ensureSurface() else { return }
    let token = nextRenderToken()
    let colorHex = UIColor.zynth_hexString(from: tintColor)

    renderQueue.async { [weak self] in
      guard let self else { return }
      guard token == self.renderToken else { return }
      runtime.callGlobal(
        "__zynth_renderTabIcon",
        args: [surfaceId, routeKey, active, colorHex]
      )
    }
  }

  func teardown() {
    _ = nextRenderToken()
    guard let runtime = runtime, let surfaceId = surfaceId else { return }
    self.surfaceId = nil
    renderQueue.async {
      runtime.callGlobal("__zynth_disposeTabIcon", args: [surfaceId])
      DispatchQueue.main.async {
        runtime.unregisterSurface(id: surfaceId)
      }
    }
  }

  deinit {
    teardown()
  }

  private func ensureSurface() -> Int32? {
    if let surfaceId {
      return surfaceId
    }
    guard let runtime = runtime else { return nil }
    let registered = runtime.registerSurface(rootView: contentView)
    surfaceId = registered
    return registered
  }

  private func nextRenderToken() -> Int {
    renderToken &+= 1
    return renderToken
  }
}
