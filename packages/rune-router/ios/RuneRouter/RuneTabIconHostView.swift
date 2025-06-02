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
    currentRuneId = runeId
    currentActive = isActive

    guard let runeId else {
      clearIcon()
      return
    }
    guard let surface = ensureSurface() else {
      NSLog("\(kRuneTabIconHostLog) Surface unavailable; cannot render icon \(runeId)")
      return
    }
    renderIcon(surfaceId: surface, runeId: runeId, active: isActive)
  }

  func updateActiveState(_ isActive: Bool) {
    guard let runeId = currentRuneId else { return }
    if currentActive == isActive { return }
    bindIcon(runeId: runeId, isActive: isActive)
  }

  func clearIcon() {
    currentRuneId = nil
    guard let surface = surfaceId else { return }
    guard let runtime else { return }
    let rootSurface = runtime.rootSurfaceId
    DispatchQueue.main.async { [weak runtime] in
      runtime?.setActiveSurface(Int(surface))
    }
    print("[RuneTabIconHost] dispose surface", surface, "runeId", currentRuneId ?? "<unknown>")
    renderQueue.async { [weak runtime] in
      runtime?.callGlobal("__disposeTabIcon", args: [surface])
      DispatchQueue.main.async { [weak runtime] in
        runtime?.setActiveSurface(rootSurface)
      }
    }
  }

  func dispose() {
    clearIcon()
    if let surface = surfaceId {
      runtime?.unregisterSurface(id: surface)
    }
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

  private func renderIcon(surfaceId: Int, runeId: String, active: Bool) {
    guard let runtime else { return }
    let rootSurface = runtime.rootSurfaceId
    print("[RuneTabIconHost] render surface", surfaceId, "runeId", runeId, "active", active)
    DispatchQueue.main.async { [weak runtime] in
      runtime?.setActiveSurface(Int(surfaceId))
    }
    renderQueue.async { [weak runtime] in
      runtime?.callGlobal("__renderTabIcon", args: [surfaceId, runeId, active])
      DispatchQueue.main.async { [weak runtime] in
        runtime?.setActiveSurface(rootSurface)
      }
    }
  }
}
