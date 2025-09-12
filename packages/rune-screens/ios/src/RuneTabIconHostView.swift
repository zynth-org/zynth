import RuneKit
import UIKit

final class RuneTabIconHostView: UIView {
  private let contentView = UIView()
  private weak var runtime: RuneRuntime?
  private var surfaceId: Int?
  private var routeKey: String?
  private var renderToken = 0
  private let renderQueue = DispatchQueue(label: "dev.rune.tabIcon.render", qos: .userInitiated)

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

  func configure(routeKey: String, runtime: RuneRuntime?) {
    guard routeKey != self.routeKey else { return }
    teardown()
    self.routeKey = routeKey
    self.runtime = runtime
    _ = ensureSurface()
  }

  func renderIcon(active: Bool, tintColor: UIColor) {
    guard let routeKey, let runtime = runtime, let surfaceId = ensureSurface() else { return }
    let token = nextRenderToken()
    let rootSurface = runtime.rootSurfaceId
    let colorHex = UIColor.rune_hexString(from: tintColor)

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard token == self.renderToken else { return }
      runtime.setActiveSurface(surfaceId)
    }

    renderQueue.async { [weak self] in
      guard let self else { return }
      guard token == self.renderToken else { return }
      runtime.callGlobal(
        "__rune_renderTabIcon",
        args: [surfaceId, routeKey, active, colorHex]
      )
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        guard token == self.renderToken else { return }
        runtime.setActiveSurface(rootSurface)
      }
    }
  }

  func teardown() {
    _ = nextRenderToken()
    guard let runtime = runtime, let surfaceId = surfaceId else { return }
    let rootSurface = runtime.rootSurfaceId
    self.surfaceId = nil
    renderQueue.async {
      runtime.callGlobal("__rune_disposeTabIcon", args: [surfaceId])
      DispatchQueue.main.async {
        runtime.setActiveSurface(rootSurface)
        runtime.unregisterSurface(id: surfaceId)
      }
    }
  }

  deinit {
    teardown()
  }

  private func ensureSurface() -> Int? {
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
