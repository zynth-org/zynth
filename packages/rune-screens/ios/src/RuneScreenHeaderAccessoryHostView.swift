import RuneKit
import UIKit

final class RuneScreenHeaderAccessoryHostView: UIView {
  private let contentView = UIView()
  private weak var runtime: RuneRuntime?
  private var surfaceId: Int?
  private var accessory: RuneScreenHeaderAccessory?
  private let renderQueue = DispatchQueue(label: "dev.rune.headerAccessory.render", qos: .userInitiated)
  private var renderToken = 0

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
    translatesAutoresizingMaskIntoConstraints = false
    contentView.backgroundColor = .clear
    contentView.frame = bounds
    contentView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(contentView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    contentView.frame = bounds
  }

  override var intrinsicContentSize: CGSize {
    if contentView.bounds.width > 0 && contentView.bounds.height > 0 {
      return CGSize(width: max(contentView.bounds.width, 44), height: max(contentView.bounds.height, 32))
    }
    return CGSize(width: 44, height: 32)
  }

  func configure(with accessory: RuneScreenHeaderAccessory, screenView: RuneScreenView) {
    self.accessory = accessory
    runtime = screenView.runtime
    guard ensureSurface() != nil else { return }
    renderAccessory()
  }

  func teardown(isDeinit: Bool = false) {
    let token = nextRenderToken()
    guard let surfaceId, let runtime else { return }
    let rootSurface = runtime.rootSurfaceId

    if isDeinit {
      let queue = renderQueue
      queue.async { [weak runtime] in
        guard let runtime else { return }
        runtime.callGlobal("__rune_disposeHeaderAccessory", args: [surfaceId])
        DispatchQueue.main.async { [weak runtime] in
          guard let runtime else { return }
          runtime.setActiveSurface(rootSurface)
          runtime.unregisterSurface(id: surfaceId)
        }
      }
      return
    }

    renderQueue.async { [weak self, weak runtime] in
      guard let self, let runtime else { return }
      runtime.callGlobal("__rune_disposeHeaderAccessory", args: [surfaceId])
      DispatchQueue.main.async { [weak self, weak runtime] in
        guard let self, let runtime else { return }
        guard token == self.renderToken else { return }
        runtime.setActiveSurface(rootSurface)
        runtime.unregisterSurface(id: surfaceId)
        self.surfaceId = nil
      }
    }
  }

  deinit {
    teardown(isDeinit: true)
  }

  private func ensureSurface() -> Int? {
    if let surfaceId {
      return surfaceId
    }
    guard let runtime else { return nil }
    let registered = runtime.registerSurface(rootView: contentView)
    surfaceId = registered
    return registered
  }

  private func renderAccessory() {
    let token = nextRenderToken()
    guard let surfaceId = ensureSurface(), let runtime, let accessory else { return }
    let rootSurface = runtime.rootSurfaceId
    DispatchQueue.main.async { [weak self, weak runtime] in
      guard let self, let runtime else { return }
      guard token == self.renderToken else { return }
      runtime.setActiveSurface(surfaceId)
    }
    renderQueue.async { [weak self, weak runtime] in
      guard let self, let runtime else { return }
      guard token == self.renderToken else { return }
      runtime.callGlobal(
        "__rune_renderHeaderAccessory",
        args: [surfaceId, accessory.routeKey, accessory.position]
      )
      DispatchQueue.main.async { [weak self, weak runtime] in
        guard let self, let runtime else { return }
        guard token == self.renderToken else { return }
        runtime.setActiveSurface(rootSurface)
      }
    }
  }

  private func nextRenderToken() -> Int {
    renderToken &+= 1
    return renderToken
  }
}
