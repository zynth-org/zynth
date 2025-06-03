import Foundation
import RuneKit
import UIKit

private let kRuneTabIconHostLog = "[RuneTabIconHost]"

final class RuneTabIconHostView: UIView {
  private weak var runtime: RuneRuntime?
  private var surfaceId: Int?
  private var currentRuneId: String?
  private var currentActive = false
  private let iconRoot = UIView()
  private let renderQueue = DispatchQueue(label: "dev.rune.tabicon.render", qos: .userInitiated)
  // renderToken drops any in-flight render/dispose work once a new bind starts.
  private var renderToken = 0

  init(runtime: RuneRuntime) {
    self.runtime = runtime
    super.init(frame: .zero)
    commonInit()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  private func commonInit() {
    backgroundColor = .clear
    isUserInteractionEnabled = false
    iconRoot.backgroundColor = .clear
    iconRoot.frame = bounds
    iconRoot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(iconRoot)
  }

  override var intrinsicContentSize: CGSize {
    return CGSize(width: 24, height: 24)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    iconRoot.frame = bounds
  }

  func bindIcon(runeId: String?, isActive: Bool) {
    let token = nextRenderToken()
    currentRuneId = runeId
    currentActive = isActive

    guard let runeId else {
      clearIcon(token: token)
      return
    }
    guard let surface = ensureSurface() else {
      NSLog("\(kRuneTabIconHostLog) Surface unavailable; cannot render icon \(runeId)")
      return
    }
    renderIcon(surfaceId: surface, runeId: runeId, active: isActive, token: token)
  }

  func updateActiveState(_ isActive: Bool) {
    guard let runeId = currentRuneId else { return }
    if currentActive == isActive { return }
    bindIcon(runeId: runeId, isActive: isActive)
  }

  func clearIcon(token: Int? = nil, unregisterSurface: Bool = false) {
    let currentToken = token ?? nextRenderToken()
    let runeIdentifier = currentRuneId
    currentRuneId = nil
    guard let surface = surfaceId else { return }
    guard let runtime else { return }
    print("[RuneTabIconHost] dispose surface", surface, "runeId", runeIdentifier ?? "<unknown>")
    renderQueue.async { [weak self, weak runtime] in
      guard let self, let runtime else { return }
      guard currentToken == self.renderToken else { return }
      runtime.callGlobal("__disposeTabIcon", args: [surface])
      if unregisterSurface {
        runtime.unregisterSurface(id: surface)
      }
    }
  }

  func dispose() {
    let token = nextRenderToken()
    clearIcon(token: token, unregisterSurface: true)
    surfaceId = nil
  }

  private func ensureSurface() -> Int? {
    if let surfaceId {
      return surfaceId
    }
    guard let runtime else {
      return nil
    }
    let registered = runtime.registerSurface(rootView: iconRoot)
    surfaceId = registered
    return registered
  }

  private func renderIcon(surfaceId: Int, runeId: String, active: Bool, token: Int) {
    guard let runtime else { return }
    print("[RuneTabIconHost] render surface", surfaceId, "runeId", runeId, "active", active)
    renderQueue.async { [weak self, weak runtime] in
      guard let self, let runtime else { return }
      guard token == self.renderToken else { return }
      runtime.callGlobal("__renderTabIcon", args: [surfaceId, runeId, active])
    }
  }

  private func nextRenderToken() -> Int {
    renderToken &+= 1
    return renderToken
  }
}
